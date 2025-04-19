FROM alpine AS builder
WORKDIR /build
COPY ./ ./
