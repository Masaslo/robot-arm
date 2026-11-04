#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "tcp_protocol.h"

static void check(const char *s, tcp_frame_result_t expected, unsigned servo_id, unsigned angle)
{
    tcp_frame_t frame = {0};
    tcp_frame_result_t result = TCP_FRAME_MORE;
    for (size_t i = 0; i < strlen(s) && result == TCP_FRAME_MORE; ++i)
        result = tcp_frame_feed(&frame, (unsigned char)s[i]);
    assert(result == expected);
    if (result == TCP_FRAME_VALID) {
        assert(frame.servo_id == servo_id);
        assert(frame.angle == angle);
    }
}
int main(void)
{
    check("0:0\n", TCP_FRAME_VALID, 0, 0);
    check("5:180\n", TCP_FRAME_VALID, 5, 180);
    check("03:090\n", TCP_FRAME_VALID, 3, 90);
    check("6:90\n", TCP_FRAME_INVALID, 0, 0);
    check("15:180\n", TCP_FRAME_INVALID, 0, 0);
    check("1:181\n", TCP_FRAME_INVALID, 0, 0);
    check("-1:90\n", TCP_FRAME_INVALID, 0, 0);
    check("1:+90\n", TCP_FRAME_INVALID, 0, 0);
    check("1:90\r\n", TCP_FRAME_INVALID, 0, 0);
    check("1:90 \n", TCP_FRAME_INVALID, 0, 0);
    check(":90\n", TCP_FRAME_INVALID, 0, 0);
    check("1:\n", TCP_FRAME_INVALID, 0, 0);
    check("1:2:3\n", TCP_FRAME_INVALID, 0, 0);
    check("999999999999999999999:0\n", TCP_FRAME_INVALID, 0, 0);
    check("1:90", TCP_FRAME_MORE, 0, 0);
    check("00000000000000:0\n", TCP_FRAME_VALID, 0, 0);
    check("000000000000000:0\n", TCP_FRAME_INVALID, 0, 0);
    check("1:90\n2:80\n", TCP_FRAME_VALID, 1, 90);
    tcp_frame_t frame = {0};
    assert(tcp_frame_feed(&frame, '1') == TCP_FRAME_MORE);
    assert(tcp_frame_feed(&frame, 0) == TCP_FRAME_INVALID);
    puts("protocol tests passed (byte-fragmented frames, bounds, malformed and incomplete input)");
}
