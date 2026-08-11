FROM nginxinc/nginx-unprivileged:1.28.0-alpine@sha256:c97ff0bf7cbae369953c6da1232ec14ad9f971d66360c5698db0856a4cd657a0

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css app.js core.js /usr/share/nginx/html/

EXPOSE 8080
