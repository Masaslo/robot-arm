#include <string.h>
#include <assert.h>
#include <limits.h>
#include "esp_event.h"
#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#include "wifi_config.h"
// Server waar de POST naartoe wordt gestuurd.
#define BACKEND_IP "192.168.2.36"
#define BACKEND_PORT 3000
#define STRINGIFY_EXPAND(value) #value
#define STRINGIFY(value) STRINGIFY_EXPAND(value)
#define POST_URL "http://" BACKEND_IP ":" STRINGIFY(BACKEND_PORT) "/api/camera/frame"

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
static const char *TAG = "camera";

// Verstuur de JPEG-bytes als ruwe image/jpeg-body.
static esp_err_t send_http_post(const uint8_t *data, size_t len)
{
    if (!data || len > INT_MAX) return ESP_ERR_INVALID_ARG;

    esp_http_client_config_t config = {.url = POST_URL};
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_ERR_NO_MEM;

    esp_err_t err = esp_http_client_set_method(client, HTTP_METHOD_POST);
    if (err == ESP_OK) err = esp_http_client_set_header(client, "Content-Type", "image/jpeg");
    if (err == ESP_OK) err = esp_http_client_set_post_field(client, (const char *)data, (int)len);
    if (err == ESP_OK) err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);
    return err;
}

// Stel de camera-pinnen van een AI Thinker ESP32-CAM in.
static void camera_init(void)
{
    camera_config_t config = {
        .pin_pwdn = 32, .pin_reset = -1, .pin_xclk = 0,
        .pin_sccb_sda = 26, .pin_sccb_scl = 27,
        .pin_d7 = 35, .pin_d6 = 34, .pin_d5 = 39, .pin_d4 = 36,
        .pin_d3 = 21, .pin_d2 = 19, .pin_d1 = 18, .pin_d0 = 5,
        .pin_vsync = 25, .pin_href = 23, .pin_pclk = 22,
        .xclk_freq_hz = 20000000,
        .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG, .frame_size = FRAMESIZE_QVGA, // Klein formaat past zonder PSRAM.
        .jpeg_quality = 12, .fb_count = 1,
        .fb_location = CAMERA_FB_IN_DRAM, .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
    };
    ESP_ERROR_CHECK(esp_camera_init(&config));
}

// Maak één foto, verstuur hem en geef de camerabuffer weer vrij.
static esp_err_t capture_and_send_jpeg(void)
{
    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) return ESP_FAIL;

    esp_err_t err = send_http_post(frame->buf, frame->len);
    esp_camera_fb_return(frame);
    return err;
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    // Start de verbinding opnieuw bij opstarten of na wegvallen van Wi-Fi.
    if (event_base == WIFI_EVENT &&
        (event_id == WIFI_EVENT_STA_START || event_id == WIFI_EVENT_STA_DISCONNECTED)) {
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        // Geef aan dat Wi-Fi verbonden is en een IP-adres heeft.
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_connect(void)
{
    // Initialiseer opslag, netwerk en de event-loop van ESP-IDF.
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    // Start Wi-Fi als station en registreer de verbindingsgebeurtenissen.
    wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_config));
    s_wifi_event_group = xEventGroupCreate();
    assert(s_wifi_event_group);
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));

    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, WIFI_SSID, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, WIFI_PASSWORD, sizeof(wifi_config.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    // Wacht tot de verbinding klaar is voordat de rest van de app verdergaat.
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
}

void app_main(void)
{
    wifi_connect();
    camera_init();

    while(1){
        esp_err_t err = capture_and_send_jpeg();
        if (err != ESP_OK) ESP_LOGE(TAG, "JPEG POST mislukt: %s", esp_err_to_name(err));
        vTaskDelay(pdMS_TO_TICKS(100)); // Wacht 100 mili tussen foto's.
    }

}
