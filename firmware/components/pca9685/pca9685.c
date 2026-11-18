/*
 * PCA9685 ESP-IDF Driver by TNY Robotics
 *
 * SPDX-FileCopyrightText: 2025 TNY Robotics
 * SPDX-License-Identifier: MIT
 * 
 * 
 * Copyright (C) 2025 TNY Robotics
 * 
 * This file is part of the PCA9685 ESP-IDF Driver.
 * 
 * License: MIT
 * Repository: https://github.com/tny-robotics/pca9685-esp-idf
 * 
 * Author: TNY Robotics
 * Date: 04/10/2025
 * Version: 1.0
 */

#include "pca9685.h"
#include <stdint.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <driver/i2c_master.h>
#include <esp_log.h>
#include <esp_check.h>
#include <math.h>

/* PCA9685 register */
#define PCA9685_MODE1 0x00
#define PCA9685_MODE2 0x01
#define PCA9685_PRESCALER 0xFE
#define PCA9685_LED0_ON 0x06
#define PCA9685_LED0_OFF 0x08
#define PCA9685_LED_REG_SHIFT 4 // 4 registers for each led
#define PCA9685_ALL_LED_ON_L 0xFA

/* PCA9685 constants */
#define PCA9685_OSC_CLOCK 25000000

static esp_err_t pca9685_write(pca9685_handle_t pca, const uint8_t reg_start_addr, const uint8_t *const data_buf, const uint8_t data_len)
{
    uint8_t tmp[data_len+1];
    tmp[0] = reg_start_addr;
    for (uint8_t i = 0; i < data_len; i++)
        tmp[i+1] = data_buf[i];
    return i2c_master_transmit(pca.dev_handle, tmp, data_len+1, pdMS_TO_TICKS(1000)); // 1s timeout
}

static esp_err_t pca9685_read(pca9685_handle_t pca, const uint8_t reg_start_addr, uint8_t *const data_buf, const uint8_t data_len)
{
    return i2c_master_transmit_receive(pca.dev_handle, &reg_start_addr, 1, data_buf, data_len, pdMS_TO_TICKS(1000)); // 1s timeout
}

esp_err_t pca9685_create(i2c_master_bus_handle_t i2c_bus_handle, pca9685_info_t info, pca9685_handle_t* out_pca_handle)
{
    if (out_pca_handle == NULL)
        return ESP_ERR_NO_MEM;

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = info.address,
        .scl_speed_hz = info.clock_speed,
    };

    return i2c_master_bus_add_device(i2c_bus_handle, &dev_cfg, &out_pca_handle->dev_handle);
}

esp_err_t pca9685_config(pca9685_handle_t pca_handle, pca9685_config_t config)
{
    // set all LED_ON registers to zero (no delay before duty cycle)
    uint8_t two_zeros[2] = { 0, 0 };
    uint8_t reg_addr;
    ESP_LOGD("PCA9685", "Resetting PCA9685 LED_ON registers to 0 ...");
    for (int i = 0; i < PCA9685_NB_CHANNELS; i++)
    {
        reg_addr = PCA9685_LED0_ON + i * PCA9685_LED_REG_SHIFT;
        pca9685_write(pca_handle, reg_addr, two_zeros, 2); // white 0 on LED_ON_H and LED_ON_L
    }

    // Disable ALL CALL to avoid weird additionnal I2C Adress responses
    // And enable AI (Auto-Increment) for easier multi-byte writes
    ESP_LOGD("PCA9685", "Configuring PCA9685 MODE1 register (disable ALL CALL, enable AI) ...");
    {
        uint8_t mode1_reg;
        esp_err_t ret = pca9685_read(pca_handle, PCA9685_MODE1, &mode1_reg, 1);
        if (ret != ESP_OK) return ret;
        mode1_reg &= (~BIT0); // clear bit 0 (ALLCALL)
        mode1_reg |= BIT5;    // set bit 5 (AI)
        ret = pca9685_write(pca_handle, PCA9685_MODE1, &mode1_reg, 1);
        if (ret != ESP_OK) return ret;
    }

    // set pca to sleep mode (required to change prescale)
    ESP_LOGD("PCA9685", "Putting PCA9685 to sleep mode to set prescaler ...");
    esp_err_t ret = pca9685_sleep(pca_handle);
    if (ret != ESP_OK) return ret;

    // prescale_value = round(osc_clock / (4096 * update_rate)) - 1 [at page 25 of datasheet]
    uint8_t prescaler_value = round((PCA9685_OSC_CLOCK / 4096 / config.frequency_hz) - 1);
    ESP_LOGD("PCA9685", "Changing PCA9685 prescaler to set frequency to %d Hz (prescaler value: %d) ...", config.frequency_hz, prescaler_value);
    ret = pca9685_write(pca_handle, PCA9685_PRESCALER, &prescaler_value, 1);
    if (ret != ESP_OK) return ret;

    // wake up pca (frequency has been changed, back to normal)
    ESP_LOGD("PCA9685", "Waking up PCA9685 ...");
    return pca9685_wake_up(pca_handle);
}

esp_err_t pca9685_reset(pca9685_handle_t pca_handle)
{
    esp_err_t ret;

    // MODE1 : Sleep + Auto-Increment
    uint8_t mode1_val = BIT4 | BIT5; 
    ret = pca9685_write(pca_handle, PCA9685_MODE1, &mode1_val, 1);
    if (ret != ESP_OK) return ret;

    // MODE2 : Factory reset (Totem Pole output = 0x04)
    uint8_t mode2_val = 0x04;
    ret = pca9685_write(pca_handle, PCA9685_MODE2, &mode2_val, 1);
    if (ret != ESP_OK) return ret;

    // Turn off all channels (FULL OFF)
    uint8_t all_led_off[4] = {0x00, 0x00, 0x00, 0x10}; 
    ret = pca9685_write(pca_handle, PCA9685_ALL_LED_ON_L, all_led_off, 4);
    
    return ret;
}

esp_err_t pca9685_wake_up(pca9685_handle_t pca_handle)
{
    esp_err_t ret;
    uint8_t tmp;
    ret = pca9685_read(pca_handle, PCA9685_MODE1, &tmp, 1);
    if (ESP_OK != ret) {
        return ret;
    }

    tmp &= (~BIT4); // sleep bit to zero
    ret = pca9685_write(pca_handle, PCA9685_MODE1, &tmp, 1);
    if (ESP_OK != ret) {
        return ret;
    }

    // wait 500 microseconds (rounded to 1ms) and write 1 in RESTART bit
    vTaskDelay(pdMS_TO_TICKS(1));
    tmp |= BIT7;
    ret = pca9685_write(pca_handle, PCA9685_MODE1, &tmp, 1);
    if (ESP_OK != ret) {
        return ret;
    }

    return ret;
}

esp_err_t pca9685_sleep(pca9685_handle_t pca_handle)
{
    esp_err_t ret;
    uint8_t tmp;
    ret = pca9685_read(pca_handle, PCA9685_MODE1, &tmp, 1);
    if (ESP_OK != ret) {
        return ret;
    }
    tmp |= BIT4; // sleep bit to one
    ret = pca9685_write(pca_handle, PCA9685_MODE1, &tmp, 1);
    if (ESP_OK != ret) {
        return ret;
    }
    return ret;
}

esp_err_t pca9685_set_pwm(pca9685_handle_t pca_handle, uint8_t channel, uint16_t val)
{
    if (val >= 4096)
    {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t reg_addr = PCA9685_LED0_OFF + channel * PCA9685_LED_REG_SHIFT;
    uint8_t data[2] = { val & 0xFF, (val >> 8) & 0xFF };
    return pca9685_write(pca_handle, reg_addr, data, 2);
}

esp_err_t pca9685_set_pwms(pca9685_handle_t pca_handle, uint16_t vals[PCA9685_NB_CHANNELS])
{
    for (int i = 0; i < PCA9685_NB_CHANNELS; i++)
    {
        if (vals[i] >= 4096)
        {
            return ESP_ERR_INVALID_ARG;
        }
    }

    uint8_t data[PCA9685_NB_CHANNELS*PCA9685_LED_REG_SHIFT];
    for (int i = 0; i < PCA9685_NB_CHANNELS; i++)
    {
        data[i * PCA9685_LED_REG_SHIFT + 0] = 0;                         // LED_ON_L to 0
        data[i * PCA9685_LED_REG_SHIFT + 1] = 0;                         // LED_ON_H to 0
        data[2 + i * PCA9685_LED_REG_SHIFT + 0] = vals[i] & 0xFF;        // LED_OFF low register
        data[2 + i * PCA9685_LED_REG_SHIFT + 1] = (vals[i] >> 8) & 0xFF; // LED_OFF high register
    }

    return pca9685_write(pca_handle, PCA9685_LED0_ON, data, PCA9685_NB_CHANNELS*PCA9685_LED_REG_SHIFT);
}

esp_err_t pca9685_delete(pca9685_handle_t pca_handle)
{
    i2c_master_bus_rm_device(pca_handle.dev_handle);
    return ESP_OK;
}
