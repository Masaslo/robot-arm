#pragma once
/* Half-close output, then consume at most 4096 input bytes in bounded waits.
 * The caller owns the final close(). No input drained here is executed. */
void tcp_finish_response(int socket_fd);
