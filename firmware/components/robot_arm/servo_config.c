#include "servo_config.h"

#include <stddef.h>

static const servo_config_t servo_config[SERVO_COUNT] = {
    [SERVO_HIP] = {.pca_channel = 1, .direction = 1, .offset_degrees = 0},
    [SERVO_SHOULDER] = {.pca_channel = 2, .direction = 1, .offset_degrees = 0},
    [SERVO_ELBOW] = {.pca_channel = 3, .direction = 1, .offset_degrees = 0},
    [SERVO_WRIST] = {.pca_channel = 4, .direction = -1, .offset_degrees = 0},
    [SERVO_PALM] = {.pca_channel = 5, .direction = 1, .offset_degrees = 0},
    [SERVO_FINGERS] = {.pca_channel = 6, .direction = 1, .offset_degrees = 0},
};

const servo_config_t *servo_config_for_id(servo_id_t servo_id)
{
    const int id = (int)servo_id;
    if (id < 0 || id >= SERVO_COUNT) {
        return NULL;
    }
    return &servo_config[id];
}

const servo_config_t *servo_config_for_pca_channel(uint8_t pca_channel)
{
    for (int id = 0; id < SERVO_COUNT; ++id) {
        if (servo_config[id].pca_channel == pca_channel) {
            return &servo_config[id];
        }
    }
    return NULL;
}
