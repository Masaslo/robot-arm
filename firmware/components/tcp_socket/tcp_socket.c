#include "tcp_socket.h"
#include "sdkconfig.h"

#include <errno.h>
#include <stdbool.h>
#include <unistd.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "robot_arm.h"
#include "tcp_protocol.h"
#include "tcp_close.h"
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#define WIFI_SSID CONFIG_ROBOT_ARM_WIFI_SSID
#define WIFI_PASSWORD CONFIG_ROBOT_ARM_WIFI_PASSWORD

static const char *TAG = "tcp_socket_wifi";
static bool s_wifi_started;
static EventGroupHandle_t s_network_events;
static TaskHandle_t s_server_task;
#define IP_READY BIT0

static void wifi_event_handler(void *arg,
                               esp_event_base_t event_base,
                               int32_t event_id,
                               void *event_data)
{
    (void)arg;
    (void)event_data;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Wi-Fi verbinding starten mislukt: %s", esp_err_to_name(err));
        }
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_network_events, IP_READY);
        ESP_LOGW(TAG, "Wi-Fi verbinding verbroken; opnieuw verbinden...");
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Opnieuw verbinden mislukt: %s", esp_err_to_name(err));
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_LOST_IP) {
        xEventGroupClearBits(s_network_events, IP_READY);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_network_events, IP_READY);
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Verbonden; IP-adres: " IPSTR, IP2STR(&event->ip_info.ip));
    }
}

esp_err_t tcp_socket_wifi_init(void)
{
    if (s_wifi_started) {
        return ESP_OK;
    }

    if (s_network_events == NULL) {
        s_network_events = xEventGroupCreate();
        if (s_network_events == NULL) return ESP_ERR_NO_MEM;
    }

    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS initialiseren mislukt: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Netwerkinterface initialiseren mislukt: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Event loop aanmaken mislukt: %s", esp_err_to_name(err));
        return err;
    }

    if (esp_netif_create_default_wifi_sta() == NULL) {
        ESP_LOGE(TAG, "Wi-Fi netwerkinterface aanmaken mislukt");
        return ESP_FAIL;
    }

    const wifi_init_config_t wifi_init_config = WIFI_INIT_CONFIG_DEFAULT();
    err = esp_wifi_init(&wifi_init_config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi driver initialiseren mislukt: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                     wifi_event_handler, NULL);
    if (err == ESP_OK) {
        err = esp_event_handler_register(IP_EVENT, ESP_EVENT_ANY_ID,
                                         wifi_event_handler, NULL);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi event handlers registreren mislukt: %s", esp_err_to_name(err));
        return err;
    }

    wifi_config_t wifi_config = { 0 };
    const size_t ssid_length = strlen(WIFI_SSID);
    const size_t password_length = strlen(WIFI_PASSWORD);
    if (ssid_length == 0 || ssid_length > sizeof(wifi_config.sta.ssid) ||
        password_length > sizeof(wifi_config.sta.password)) {
        ESP_LOGE(TAG, "SSID of wachtwoord is langer dan de Wi-Fi-instellingen toelaten");
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(wifi_config.sta.ssid, WIFI_SSID, ssid_length);
    memcpy(wifi_config.sta.password, WIFI_PASSWORD, password_length);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err == ESP_OK) {
        err = esp_wifi_set_storage(WIFI_STORAGE_RAM);
    }
    if (err == ESP_OK) {
        err = esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    }
    if (err == ESP_OK) {
        err = esp_wifi_start();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi starten mislukt: %s", esp_err_to_name(err));
        return err;
    }

    s_wifi_started = true;
    ESP_LOGI(TAG, "Verbinden met Wi-Fi netwerk...");
    return ESP_OK;
}

static void reply_to_client(int client, bool accepted)
{
    const char *reply = accepted ? "OK\n" : "ERR\n";
    size_t remaining = strlen(reply);
    while (remaining) {
        int sent = send(client, reply, remaining, 0);
        if (sent < 0 && errno == EINTR) continue;
        if (sent <= 0) break;
        reply += sent;
        remaining -= sent;
    }
}

static void handle_client(int client)
{
    struct timeval timeout = { .tv_sec = 5 };
    if (setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0 ||
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) < 0)
        return;
    tcp_frame_t frame = {0};
    tcp_frame_result_t result = TCP_FRAME_MORE;
    /* An absolute deadline also bounds clients that trickle bytes. */
    TickType_t started = xTaskGetTickCount();
    while (result == TCP_FRAME_MORE &&
           (xTaskGetTickCount() - started) < pdMS_TO_TICKS(5000) &&
           (xEventGroupGetBits(s_network_events) & IP_READY)) {
        TickType_t remaining = pdMS_TO_TICKS(5000) - (xTaskGetTickCount() - started);
        if (remaining > pdMS_TO_TICKS(5000)) break;
        unsigned remaining_ms = remaining * portTICK_PERIOD_MS;
        if (remaining_ms == 0) break;
        timeout.tv_sec = remaining_ms / 1000;
        timeout.tv_usec = (remaining_ms % 1000) * 1000;
        if (setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0) break;
        unsigned char byte;
        int received = recv(client, &byte, 1, 0);
        if (received < 0 && errno == EINTR) continue;
        if (received != 1) break;
        result = tcp_frame_feed(&frame, byte);
    }
    bool accepted = result == TCP_FRAME_VALID &&
                    (xEventGroupGetBits(s_network_events) & IP_READY) &&
                    lerp_to_servo_angle((int)frame.channel, (int)frame.angle) == ESP_OK;
    reply_to_client(client, accepted);
}

static void tcp_server_task(void *arg)
{
    (void)arg;
    for (;;) {
        xEventGroupWaitBits(s_network_events, IP_READY, pdFALSE, pdTRUE, portMAX_DELAY);
        int listener = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
        if (listener < 0) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        int reuse = 1;
        setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        struct sockaddr_in address = {
            .sin_family = AF_INET,
            .sin_port = htons(3333),
            .sin_addr.s_addr = htonl(INADDR_ANY),
        };
        if (bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0 ||
            listen(listener, 1) < 0) {
            ESP_LOGW(TAG, "TCP listener setup failed: errno %d", errno);
            close(listener);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        ESP_LOGI(TAG, "TCP listener ready on port 3333");
        while (xEventGroupGetBits(s_network_events) & IP_READY) {
            /* Poll readiness so a Wi-Fi disconnect never leaves accept blocked. */
            fd_set readers;
            FD_ZERO(&readers);
            FD_SET(listener, &readers);
            struct timeval poll_timeout = { .tv_sec = 1 };
            int ready = select(listener + 1, &readers, NULL, NULL, &poll_timeout);
            if (ready < 0 && errno == EINTR) continue;
            if (ready < 0) break;
            if (ready == 0) continue;
            int client = accept(listener, NULL, NULL);
            if (client < 0) break;
            handle_client(client);
            tcp_finish_response(client);
            close(client);
        }
        close(listener);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

esp_err_t tcp_socket_start(void)
{
    if (!s_wifi_started) return ESP_ERR_INVALID_STATE;
    if (s_server_task != NULL) return ESP_OK;
    if (xTaskCreate(tcp_server_task, "tcp_server", 4096, NULL, 5, &s_server_task) != pdPASS)
        return ESP_ERR_NO_MEM;
    return ESP_OK;
}
