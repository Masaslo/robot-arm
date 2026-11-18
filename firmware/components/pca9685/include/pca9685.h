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

#pragma once
#include <esp_err.h>
#include <driver/i2c_master.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PCA9685_NB_CHANNELS 16
#define PCA9685_DEFAULT_ADDR 0x40
#define PCA9685_DEFAULT_CLOCK 100000 // can be way higher if needed, PCA9685 supports fast mode+

/**
 * @brief Structure containing basic information about the PCA9685 device.
 * This structure holds the I2C address and clock speed required to communicate
 * with the PCA9685 PWM controller.
 */
typedef struct {
    uint16_t address;      /**< I2C address of the PCA9685 device */
    uint32_t clock_speed;  /**< I2C clock speed in Hz */
} pca9685_info_t;

/**
 * @brief Structure for configuring the PCA9685 device.
 * This structure is used to set the PWM frequency for the PCA9685 controller.
 */
typedef struct {
    uint16_t frequency_hz; /**< PWM frequency in Hz */
} pca9685_config_t;

#ifdef __cplusplus
#define PCA9685_DEFAULT_INFO() pca9685_info_t{PCA9685_DEFAULT_ADDR, PCA9685_DEFAULT_CLOCK}
#define PCA9685_DEFAULT_CONFIG() pca9685_config_t{50}
#else
#define PCA9685_DEFAULT_INFO() ((pca9685_info_t){\
    .address = PCA9685_DEFAULT_ADDR,\
    .clock_speed = PCA9685_DEFAULT_CLOCK\
})
#define PCA9685_DEFAULT_CONFIG() ((pca9685_config_t){\
    .frequency_hz = 50\
})
#endif

/**
 * @brief Handle structure for the PCA9685 device.
 * This structure contains the I2C master device handle used for communication
 * with the PCA9685 controller.
 */
typedef struct {
    i2c_master_dev_handle_t dev_handle; /**< I2C master device handle */
} pca9685_handle_t;

/**
 * @brief Create and initialize a PCA9685 device handle.
 *
 * @param i2c_bus_handle Handle to the I2C master bus.
 * @param info Configuration information for the PCA9685 device.
 * @param out_pca_handle Pointer to store the created PCA9685 handle.
 * @return
 *      - ESP_OK: Success
 *      - ESP_ERR_INVALID_ARG: Invalid arguments
 *      - ESP_FAIL: Initialization failed
 */
esp_err_t pca9685_create(i2c_master_bus_handle_t i2c_bus_handle, pca9685_info_t info, pca9685_handle_t* out_pca_handle);

/**
 * @brief Configure the PCA9685 device with the specified settings.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @param config Configuration parameters for the PCA9685.
 * @return
 *      - ESP_OK: Success
 *      - ESP_ERR_INVALID_ARG: Invalid arguments
 *      - ESP_FAIL: Configuration failed
 */
esp_err_t pca9685_config(pca9685_handle_t pca_handle, pca9685_config_t config);

/**
 * @brief Reset the PCA9685 device registers to a known safe state.
 * @note This will immediately stop all PWM outputs (FULL OFF) and put the device to sleep.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @return
 * - ESP_OK: Success
 * - ESP_FAIL: Reset failed
 */
esp_err_t pca9685_reset(pca9685_handle_t pca_handle);

/**
 * @brief Wake up the PCA9685 device from sleep mode.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @return
 *      - ESP_OK: Success
 *      - ESP_FAIL: Wake up failed
 */
esp_err_t pca9685_wake_up(pca9685_handle_t pca_handle);

/**
 * @brief Put the PCA9685 device into sleep mode.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @return
 *      - ESP_OK: Success
 *      - ESP_FAIL: Sleep failed
 */
esp_err_t pca9685_sleep(pca9685_handle_t pca_handle);

/**
 * @brief Set the PWM value for a specific channel.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @param channel Channel number to set the PWM value.
 * @param val PWM value to set (typically 0-4095).
 * @return
 *      - ESP_OK: Success
 *      - ESP_ERR_INVALID_ARG: Invalid channel or value
 *      - ESP_FAIL: Operation failed
 */
esp_err_t pca9685_set_pwm(pca9685_handle_t pca_handle, uint8_t channel, uint16_t val);

/**
 * @brief Set the PWM values for all channels.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @param vals Array of PWM values for all channels (size: PCA9685_NB_CHANNELS).
 * @return
 *      - ESP_OK: Success
 *      - ESP_ERR_INVALID_ARG: Invalid arguments
 *      - ESP_FAIL: Operation failed
 */
esp_err_t pca9685_set_pwms(pca9685_handle_t pca_handle, uint16_t vals[PCA9685_NB_CHANNELS]);

/**
 * @brief Delete and release resources associated with the PCA9685 device handle.
 *
 * @param pca_handle Handle to the PCA9685 device.
 * @return
 *      - ESP_OK: Success
 *      - ESP_FAIL: Deletion failed
 */
esp_err_t pca9685_delete(pca9685_handle_t pca_handle);

#ifdef __cplusplus
}
#endif
