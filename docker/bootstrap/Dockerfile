FROM alpine:3.20

RUN apk add --no-cache bash curl postgresql16-client

COPY bootstrap.sh /bootstrap.sh
RUN chmod +x /bootstrap.sh

ENTRYPOINT ["/bootstrap.sh"]
