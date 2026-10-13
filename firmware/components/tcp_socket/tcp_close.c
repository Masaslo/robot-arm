#include "tcp_close.h"
#include <errno.h>
#include <stddef.h>
#include <sys/select.h>
#include <sys/socket.h>

void tcp_finish_response(int socket_fd)
{
    /* lwIP SHUT_RDWR can reset a connection with unread input and purge output.
     * SHUT_WR queues FIN after the response while keeping input drainable. */
    if (shutdown(socket_fd, SHUT_WR) < 0) return;
    for (unsigned attempt = 0; attempt < 32; ++attempt) {
        fd_set readers;
        FD_ZERO(&readers);
        FD_SET(socket_fd, &readers);
        struct timeval timeout = { .tv_usec = 50000 };
        int ready = select(socket_fd + 1, &readers, NULL, NULL, &timeout);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return;
        if (ready == 0) continue;
        unsigned char discard[128];
        int received = recv(socket_fd, discard, sizeof(discard), MSG_DONTWAIT);
        if (received == 0) return;
        if (received < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK)
            return;
    }
}
