#pragma once
#include <stddef.h>

typedef enum { TCP_FRAME_MORE, TCP_FRAME_VALID, TCP_FRAME_INVALID } tcp_frame_result_t;
typedef struct {
    size_t length;
    unsigned channel;
    unsigned angle;
    unsigned digits;
    unsigned separator;
} tcp_frame_t;

/* Feed individual bytes; stop on VALID or INVALID. Maximum 16 bytes before LF. */
tcp_frame_result_t tcp_frame_feed(tcp_frame_t *frame, unsigned char byte);
