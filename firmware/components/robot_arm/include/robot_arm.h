#pragma once

#include "esp_err.h"
#include "servo_id.h"

esp_err_t robot_arm_init(void);
esp_err_t limit_speed(int degrees_per_second);
esp_err_t set_servo_angle(int servo, int angle);
esp_err_t moveServoTo(servo_id_t servo_id, int target_angle);
