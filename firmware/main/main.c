#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#include "esp_console.h"
#include "robot_arm.h"

static bool parse_long(const char *text, long min_value, long max_value, long *value)
{
    char *end = NULL;
    errno = 0;
    long parsed = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' ||
        parsed < min_value || parsed > max_value) {
        return false;
    }

    *value = parsed;
    return true;
}

static int command_servo(int argc, char **argv)
{
    if (argc != 3) {
        printf("Gebruik: servo <kanaal 0-15> <hoek 0-180>\n");
        return 1;
    }

    long channel;
    long angle;
    if (!parse_long(argv[1], 0, 15, &channel)) {
        printf("Ongeldig kanaal. Gebruik een getal van 0 t/m 15.\n");
        return 1;
    }
    if (!parse_long(argv[2], 0, 180, &angle)) {
        printf("Ongeldige hoek. Gebruik een getal van 0 t/m 180.\n");
        return 1;
    }

    esp_err_t err = set_servo_angle((int)channel, (int)angle);
    if (err != ESP_OK) {
        printf("Servo-aansturing mislukt: %s\n", esp_err_to_name(err));
        return 1;
    }

    printf("Kanaal %ld ingesteld op %ld graden.\n", channel, angle);
    return 0;
}

static int command_speed(int argc, char **argv)
{
    if (argc != 2) {
        printf("Gebruik: speed <graden-per-seconde 1-360>\n");
        return 1;
    }

    long speed;
    if (!parse_long(argv[1], 1, 360, &speed)) {
        printf("Ongeldige snelheid. Gebruik een getal van 1 t/m 360 graden per seconde.\n");
        return 1;
    }

    esp_err_t err = limit_speed((int)speed);
    if (err != ESP_OK) {
        printf("Snelheid instellen mislukt: %s\n", esp_err_to_name(err));
        return 1;
    }
    printf("Lerp-snelheid ingesteld op %ld graden per seconde.\n", speed);
    return 0;
}

static int command_lerp(int argc, char **argv)
{
    if (argc != 3) {
        printf("Gebruik: lerp <kanaal 0-15> <doelhoek 0-180>\n");
        return 1;
    }

    long channel;
    long angle;
    if (!parse_long(argv[1], 0, 15, &channel)) {
        printf("Ongeldig kanaal. Gebruik een getal van 0 t/m 15.\n");
        return 1;
    }
    if (!parse_long(argv[2], 0, 180, &angle)) {
        printf("Ongeldige doelhoek. Gebruik een getal van 0 t/m 180.\n");
        return 1;
    }

    esp_err_t err = lerp_to_servo_angle((int)channel, (int)angle);
    if (err != ESP_OK) {
        printf("Lerp starten mislukt: %s\n", esp_err_to_name(err));
        return 1;
    }
    printf("Servo %ld beweegt naar %ld graden.\n", channel, angle);
    return 0;
}

void app_main(void)
{
    ESP_ERROR_CHECK(robot_arm_init());
    printf("Commando's: servo <kanaal> <hoek>, speed <graden-per-seconde>, lerp <kanaal> <doelhoek>\n");

    const esp_console_cmd_t servo_command = {
        .command = "servo",
        .help = "Stel een servohoek in: servo <kanaal 0-15> <hoek 0-180>",
        .hint = NULL,
        .func = command_servo,
        .argtable = NULL,
        .func_w_context = NULL,
        .context = NULL,
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&servo_command));

    const esp_console_cmd_t speed_command = {
        .command = "speed",
        .help = "Stel lerp-snelheid in graden per seconde in: speed <1-360>",
        .hint = NULL,
        .func = command_speed,
        .argtable = NULL,
        .func_w_context = NULL,
        .context = NULL,
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&speed_command));

    const esp_console_cmd_t lerp_command = {
        .command = "lerp",
        .help = "Beweeg een servo naar de doelhoek: lerp <kanaal 0-15> <hoek 0-180>",
        .hint = NULL,
        .func = command_lerp,
        .argtable = NULL,
        .func_w_context = NULL,
        .context = NULL,
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&lerp_command));

    esp_console_repl_config_t repl_config = ESP_CONSOLE_REPL_CONFIG_DEFAULT();
    repl_config.prompt = "robot-arm> ";

    esp_console_repl_t *repl = NULL;
    ESP_ERROR_CHECK(esp_console_new_repl_stdio(&repl_config, &repl));
    ESP_ERROR_CHECK(esp_console_start_repl(repl));
}
