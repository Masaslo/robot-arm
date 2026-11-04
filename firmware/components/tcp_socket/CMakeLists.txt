idf_component_register(SRCS "tcp_socket.c" "tcp_protocol.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_wifi esp_event esp_netif nvs_flash log lwip freertos robot_arm)
