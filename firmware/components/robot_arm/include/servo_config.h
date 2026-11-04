#pragma once

#include <stdint.h>

#include "servo_id.h"

typedef struct {
    uint8_t pca_channel;
    int8_t direction;
    int16_t offset_degrees;
} servo_config_t;

const servo_config_t *servo_config_for_id(servo_id_t servo_id);
const servo_config_t *servo_config_for_pca_channel(uint8_t pca_channel);
