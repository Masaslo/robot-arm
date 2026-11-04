#include <assert.h>
#include <stdio.h>

#include "servo_config.h"

int main(void)
{
    static const uint8_t expected_channels[SERVO_COUNT] = {1, 2, 3, 4, 5, 6};

    for (int id = 0; id < SERVO_COUNT; ++id) {
        const servo_config_t *config = servo_config_for_id((servo_id_t)id);
        assert(config != NULL);
        assert(config->pca_channel == expected_channels[id]);
        assert(servo_config_for_pca_channel(config->pca_channel) == config);
    }

    assert(servo_config_for_id((servo_id_t)-1) == NULL);
    assert(servo_config_for_id((servo_id_t)SERVO_COUNT) == NULL);
    assert(servo_config_for_pca_channel(0) == NULL);
    puts("servo ID mappings passed");
}
