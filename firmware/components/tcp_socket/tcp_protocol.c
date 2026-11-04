#include "tcp_protocol.h"

tcp_frame_result_t tcp_frame_feed(tcp_frame_t *frame, unsigned char byte)
{
    if (byte == '\n')
        return frame->separator && frame->digits ? TCP_FRAME_VALID : TCP_FRAME_INVALID;
    if (++frame->length > 16)
        return TCP_FRAME_INVALID;
    if (byte == ':' && !frame->separator && frame->digits) {
        frame->separator = 1;
        frame->digits = 0;
        return TCP_FRAME_MORE;
    }
    if (byte < '0' || byte > '9')
        return TCP_FRAME_INVALID;
    unsigned *value = frame->separator ? &frame->angle : &frame->servo_id;
    *value = *value * 10 + byte - '0';
    if (*value > (frame->separator ? 180u : SERVO_COUNT - 1u))
        return TCP_FRAME_INVALID;
    ++frame->digits;
    return TCP_FRAME_MORE;
}
