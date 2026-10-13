#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
#include "tcp_close.h"
#include "tcp_protocol.h"

static void *serve(void *arg)
{
    int listener = *(int *)arg;
    int fd = accept(listener, NULL, NULL);
    assert(fd >= 0);
    tcp_frame_t frame = {0};
    tcp_frame_result_t status = TCP_FRAME_MORE;
    while (status == TCP_FRAME_MORE) {
        unsigned char byte;
        assert(recv(fd, &byte, 1, 0) == 1);
        status = tcp_frame_feed(&frame, byte);
    }
    const char *reply = status == TCP_FRAME_VALID ? "OK\n" : "ERR\n";
    assert(send(fd, reply, strlen(reply), 0) == (ssize_t)strlen(reply));
    tcp_finish_response(fd);
    close(fd);
    return NULL;
}
static void check(const char *request, const char *expected, int peer_fin)
{
    int listener = socket(AF_INET, SOCK_STREAM, 0);
    assert(listener >= 0);
    struct sockaddr_in addr = { .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    assert(bind(listener, (struct sockaddr *)&addr, sizeof(addr)) == 0);
    socklen_t len = sizeof(addr);
    assert(getsockname(listener, (struct sockaddr *)&addr, &len) == 0);
    assert(listen(listener, 1) == 0);
    pthread_t thread;
    assert(pthread_create(&thread, NULL, serve, &listener) == 0);
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    assert(connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0);
    assert(send(fd, request, strlen(request), 0) == (ssize_t)strlen(request));
    char response[16] = {0};
    size_t total = 0;
    ssize_t n;
    while ((n = recv(fd, response + total, sizeof(response) - total - 1, 0)) > 0)
        total += (size_t)n;
    assert(n == 0);
    assert(strcmp(response, expected) == 0);
    if (peer_fin) assert(shutdown(fd, SHUT_WR) == 0);
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);
    assert(pthread_join(thread, NULL) == 0);
    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = end.tv_sec - start.tv_sec + (end.tv_nsec - start.tv_nsec) / 1e9;
    assert(elapsed < 2.5);
    close(fd);
    close(listener);
}
int main(void)
{
    check("16:90\n", "ERR\n", 1);
    check("1:90\n2:80\n", "OK\n", 1);
    check("16:90\n", "ERR\n", 0);
    check("1:90\n2:80\n", "OK\n", 0);
    puts("loopback TCP response/EOF and bounded close tests passed");
}
