#pragma once

#include "esp_err.h"

/** Start Wi-Fi in station mode and reconnect when the access point disconnects. */
esp_err_t tcp_socket_wifi_init(void);

/** Start the background TCP service after robot_arm_init() succeeds. */
esp_err_t tcp_socket_start(void);
