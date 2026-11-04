#include "tcp_socket.h"

#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <unistd.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "robot_arm.h"
#include "tcp_protocol.h"
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

// Pas hier het Wi-Fi-netwerk en het adres van de backend aan.
#define WIFI_SSID "Ysbeer Rules the World"
#define WIFI_PASSWORD "160120010609200324122005"
#define BACKEND_IP "192.168.2.36"
#define BACKEND_PORT 3333

static const char *TAG = "tcp_socket_wifi";
static bool s_wifi_started;
static EventGroupHandle_t s_network_events;
static TaskHandle_t s_client_task;
#define IP_READY BIT0
/* Latch brief disconnects even if Wi-Fi recovers between socket polls. */
#define IP_LOST BIT1

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
        xEventGroupSetBits(s_network_events, IP_LOST);
        xEventGroupClearBits(s_network_events, IP_READY);
        ESP_LOGW(TAG, "Wi-Fi verbinding verbroken; opnieuw verbinden...");
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Opnieuw verbinden mislukt: %s", esp_err_to_name(err));
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_LOST_IP) {
        xEventGroupSetBits(s_network_events, IP_LOST);
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

static bool network_ready(void)
{
    return (xEventGroupGetBits(s_network_events) & (IP_READY | IP_LOST)) == IP_READY;
}

/* Nonblocking sockets and short polls keep all socket waits responsive to Wi-Fi loss. */
static int wait_for_socket(int sock, bool writable, TickType_t started, TickType_t timeout)
{
    while (network_ready()) {
        TickType_t elapsed = xTaskGetTickCount() - started;
        if (elapsed >= timeout) {
            errno = ETIMEDOUT;
            return 0;
        }
        unsigned remaining_ms = (timeout - elapsed) * portTICK_PERIOD_MS;
        unsigned poll_ms = remaining_ms < 250 ? remaining_ms : 250;
        struct timeval poll_timeout = {
            .tv_sec = 0,
            .tv_usec = poll_ms * 1000,
        };
        fd_set ready;
        FD_ZERO(&ready);
        FD_SET(sock, &ready);
        int result = select(sock + 1, writable ? NULL : &ready,
                            writable ? &ready : NULL, NULL, &poll_timeout);
        if (result < 0 && errno == EINTR) continue;
        if (result != 0) return result;
    }
    errno = ENETDOWN;
    return -1;
}

static bool connect_to_backend(int sock, const struct sockaddr_in *address)
{
    if (fcntl(sock, F_SETFL, O_NONBLOCK) < 0) return false;
    const TickType_t started = xTaskGetTickCount();
    if (connect(sock, (const struct sockaddr *)address, sizeof(*address)) == 0)
        return network_ready();
    if (errno != EINPROGRESS && errno != EWOULDBLOCK) return false;
    if (wait_for_socket(sock, true, started, pdMS_TO_TICKS(2000)) != 1)
        return false;
    int error = 0;
    socklen_t length = sizeof(error);
    if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &error, &length) < 0)
        return false;
    if (error != 0) {
        errno = error;
        return false;
    }
    return network_ready();
}

static bool reply_to_backend(int sock, bool accepted)
{
    const char *reply = accepted ? "OK\n" : "ERR\n";
    size_t remaining = strlen(reply);
    const TickType_t started = xTaskGetTickCount();
    while (remaining) {
        if (wait_for_socket(sock, true, started, pdMS_TO_TICKS(5000)) != 1)
            return false;
        int sent = send(sock, reply, remaining, 0);
        if (sent < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
            continue;
        if (sent <= 0) return false;
        reply += sent;
        remaining -= sent;
    }
    return true;
}

static void handle_backend(int sock)
{
    tcp_frame_t frame = {0};
    TickType_t started = xTaskGetTickCount();
    while (network_ready()) {
        /* Idle connections stay open; only a partially received frame has a deadline. */
        TickType_t wait_started = frame.length ? started : xTaskGetTickCount();
        TickType_t timeout = pdMS_TO_TICKS(frame.length ? 5000 : 250);
        int ready = wait_for_socket(sock, false, wait_started, timeout);
        if (ready < 0) return;
        if (ready == 0) {
            if (frame.length) {
                ESP_LOGW(TAG, "TCP frame timed out");
                reply_to_backend(sock, false);
                return;
            }
            continue;
        }
        unsigned char byte;
        int received = recv(sock, &byte, 1, 0);
        if (received < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
            continue;
        if (received != 1) return;
        if (!network_ready()) return;
        if (frame.length == 0) started = xTaskGetTickCount();
        tcp_frame_result_t result = tcp_frame_feed(&frame, byte);
        if (result == TCP_FRAME_MORE) continue;
        if (result == TCP_FRAME_INVALID) {
            ESP_LOGW(TAG, "Invalid or oversized TCP frame; reconnecting");
            reply_to_backend(sock, false);
            return;
        }
        bool accepted = moveServoTo((servo_id_t)frame.servo_id,
                                    (int)frame.angle) == ESP_OK;
        if (!reply_to_backend(sock, accepted)) return;
        frame = (tcp_frame_t){0};
    }
}

static void tcp_client_task(void *arg)
{
    (void)arg;
    struct sockaddr_in address = {
        .sin_family = AF_INET,
        .sin_port = htons(BACKEND_PORT),
    };
    if (inet_pton(AF_INET, BACKEND_IP, &address.sin_addr) != 1) {
        ESP_LOGE(TAG, "TCP client disabled: set BACKEND_IP in tcp_socket.c to a valid IPv4 address");
        s_client_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    unsigned retry_seconds = 1;
    for (;;) {
        xEventGroupWaitBits(s_network_events, IP_READY, pdFALSE, pdTRUE, portMAX_DELAY);
        xEventGroupClearBits(s_network_events, IP_LOST);
        if (!network_ready()) continue;
        int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
        bool connected = sock >= 0 && connect_to_backend(sock, &address);
        if (connected) {
            retry_seconds = 1;
            ESP_LOGI(TAG, "Connected to backend %s:%d", BACKEND_IP,
                     BACKEND_PORT);
            handle_backend(sock);
            ESP_LOGW(TAG, "Backend connection closed; reconnecting");
        } else {
            ESP_LOGW(TAG, "Backend connection failed: errno %d", errno);
        }
        if (sock >= 0) close(sock);
        ESP_LOGI(TAG, "Retrying backend connection in %u seconds", retry_seconds);
        vTaskDelay(pdMS_TO_TICKS(retry_seconds * 1000));
        if (!connected)
            retry_seconds = retry_seconds < 16 ? retry_seconds * 2 : 30;
    }
}

esp_err_t tcp_socket_start(void)
{
    if (!s_wifi_started) return ESP_ERR_INVALID_STATE;
    if (s_client_task != NULL) return ESP_OK;
    if (xTaskCreate(tcp_client_task, "tcp_client", 4096, NULL, 5, &s_client_task) != pdPASS)
        return ESP_ERR_NO_MEM;
    return ESP_OK;
}
