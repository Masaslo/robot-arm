#include "robot_arm.h"

#include <stdbool.h>
#include <stdint.h>

#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pca9685.h"

#define I2C_PORT              I2C_NUM_0
#define I2C_SDA_GPIO          21
#define I2C_SCL_GPIO          47
#define PCA9685_ADDRESS       0x40
#define PCA9685_FREQUENCY_HZ  50
#define SERVO_MIN_PULSE_US    500
#define SERVO_MAX_PULSE_US    2500
#define SERVO_PERIOD_US       20000
#define SERVO_MAX_ANGLE       180
#define SERVO_MOVE_PERIOD_MS  20
#define SERVO_DEFAULT_SPEED   30
#define SERVO_MAX_SPEED      360
#define SERVO_INITIAL_ANGLE   90
#define SERVO_TASK_STACK      3072
#define SERVO_TASK_PRIORITY   5

static const char *TAG = "robot_arm";
static i2c_master_bus_handle_t i2c_bus;
static pca9685_handle_t pca9685;
static bool pca9685_initialized;
static SemaphoreHandle_t state_mutex;
static TaskHandle_t movement_task_handle;
static float current_angle[16];
static float target_angle[16];
static int last_output_angle[16];
static int movement_speed = SERVO_DEFAULT_SPEED;

static esp_err_t write_servo_angle(int servo, int angle);

static void servo_movement_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(SERVO_MOVE_PERIOD_MS);

    for (;;) {
        vTaskDelayUntil(&last_wake, period);
        if (xSemaphoreTake(state_mutex, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        const float step = (float)movement_speed * SERVO_MOVE_PERIOD_MS / 1000.0f;
        const float max_step = step;
        for (int servo = 0; servo < 16; ++servo) {
            const float difference = target_angle[servo] - current_angle[servo];
            if (difference == 0.0f) {
                continue;
            }

            if (difference > max_step || difference < -max_step) {
                current_angle[servo] += difference > 0.0f ? step : -step;
            } else {
                current_angle[servo] = target_angle[servo];
            }

            const int output_angle = (int)(current_angle[servo] + 0.5f);
            if (output_angle != last_output_angle[servo]) {
                esp_err_t err = write_servo_angle(servo, output_angle);
                if (err == ESP_OK) {
                    last_output_angle[servo] = output_angle;
                } else {
                    ESP_LOGE(TAG, "Servo %d bijwerken mislukt: %s",
                             servo, esp_err_to_name(err));
                }
            }
        }

        xSemaphoreGive(state_mutex);
    }
}

esp_err_t robot_arm_init(void)
{
    if (state_mutex != NULL) {
        return ESP_OK;
    }

    state_mutex = xSemaphoreCreateMutex();
    if (state_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }

    for (int servo = 0; servo < 16; ++servo) {
        current_angle[servo] = SERVO_INITIAL_ANGLE;
        target_angle[servo] = SERVO_INITIAL_ANGLE;
        last_output_angle[servo] = SERVO_INITIAL_ANGLE;
    }

    if (xTaskCreate(servo_movement_task, "servo_move", SERVO_TASK_STACK, NULL,
                    SERVO_TASK_PRIORITY, &movement_task_handle) != pdPASS) {
        vSemaphoreDelete(state_mutex);
        state_mutex = NULL;
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

static esp_err_t init_pca9685(void)
{
    if (pca9685_initialized) {
        return ESP_OK;
    }

    const i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_PORT,
        .sda_io_num = I2C_SDA_GPIO,
        .scl_io_num = I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };

    esp_err_t err = i2c_new_master_bus(&bus_config, &i2c_bus);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C-bus initialiseren mislukt: %s", esp_err_to_name(err));
        return err;
    }

    const pca9685_info_t info = {
        .address = PCA9685_ADDRESS,
        .clock_speed = PCA9685_DEFAULT_CLOCK,
    };
    err = pca9685_create(i2c_bus, info, &pca9685);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "PCA9685 aanmaken mislukt: %s", esp_err_to_name(err));
        i2c_del_master_bus(i2c_bus);
        i2c_bus = NULL;
        return err;
    }

    err = pca9685_reset(pca9685);
    if (err == ESP_OK) {
        const pca9685_config_t config = {
            .frequency_hz = PCA9685_FREQUENCY_HZ,
        };
        err = pca9685_config(pca9685, config);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "PCA9685 configureren mislukt: %s", esp_err_to_name(err));
        pca9685_delete(pca9685);
        i2c_del_master_bus(i2c_bus);
        i2c_bus = NULL;
        return err;
    }

    pca9685_initialized = true;
    return ESP_OK;
}

static esp_err_t write_servo_angle(int servo, int angle)
{
    esp_err_t err = init_pca9685();
    if (err != ESP_OK) {
        return err;
    }

    const uint32_t pulse_us = SERVO_MIN_PULSE_US +
        ((uint32_t)angle * (SERVO_MAX_PULSE_US - SERVO_MIN_PULSE_US) +
         SERVO_MAX_ANGLE / 2) / SERVO_MAX_ANGLE;
    const uint32_t pwm_count =
        (pulse_us * 4096 + SERVO_PERIOD_US / 2) / SERVO_PERIOD_US;

    return pca9685_set_pwm(pca9685, (uint8_t)servo, (uint16_t)pwm_count);
}

esp_err_t set_servo_angle(int servo, int angle)
{
    if (servo < 0 || servo > 15 || angle < 0 || angle > SERVO_MAX_ANGLE ||
        state_mutex == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = init_pca9685();
    if (err != ESP_OK) {
        return err;
    }
    if (xSemaphoreTake(state_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_FAIL;
    }

    err = write_servo_angle(servo, angle);
    if (err == ESP_OK) {
        current_angle[servo] = (float)angle;
        target_angle[servo] = (float)angle;
        last_output_angle[servo] = angle;
    }
    xSemaphoreGive(state_mutex);
    return err;
}

esp_err_t limit_speed(int degrees_per_second)
{
    if (state_mutex == NULL || degrees_per_second < 1 ||
        degrees_per_second > SERVO_MAX_SPEED) {
        return ESP_ERR_INVALID_ARG;
    }
    if (xSemaphoreTake(state_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_FAIL;
    }
    movement_speed = degrees_per_second;
    xSemaphoreGive(state_mutex);
    return ESP_OK;
}

esp_err_t lerp_to_servo_angle(int servo, int destination_angle)
{
    if (state_mutex == NULL || servo < 0 || servo > 15 ||
        destination_angle < 0 || destination_angle > SERVO_MAX_ANGLE) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = init_pca9685();
    if (err != ESP_OK) {
        return err;
    }
    if (xSemaphoreTake(state_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_FAIL;
    }
    target_angle[servo] = (float)destination_angle;
    xSemaphoreGive(state_mutex);
    return ESP_OK;
}
