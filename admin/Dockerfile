FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:3000/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Unprivileged nginx (uid 101, no root, no privileged ports) with security headers + CSP from nginx.conf
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG VITE_API_URL=http://localhost:3000/api/v1
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER root
RUN ORIGIN="$(echo "$VITE_API_URL" | sed -E 's#^(https?://[^/]+).*#\1#')" && WS="$(echo "$ORIGIN" | sed -E 's#^http#ws#')" \
    && sed -i "s#__API_ORIGIN__#$ORIGIN#g; s#__API_WS_ORIGIN__#$WS#g" /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 5173
