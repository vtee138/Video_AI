FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ffmpeg fonts-noto-core fonts-noto-color-emoji \
    ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY remotion ./remotion
COPY web ./web
COPY public ./public
COPY assets/music ./assets/music
COPY flow-extension ./flow-extension
COPY migrations ./migrations

RUN mkdir -p output .tmp .cache public/runs public/quote-images assets/flow-tryon

EXPOSE 4173
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.mjs"]
