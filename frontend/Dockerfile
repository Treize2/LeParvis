FROM nginx:alpine

# Cache rules:
# - HTML pages: never cache, always revalidate (so deploys are visible on
#   next page load without forcing the user to hard-refresh).
# - JS / CSS / fonts / images: cache for 1 day on the proxy + browser, since
#   their URLs are versioned with ?v=N query strings already.
COPY default.conf /etc/nginx/conf.d/default.conf

COPY index.html  /usr/share/nginx/html/index.html
COPY app.js      /usr/share/nginx/html/app.js
COPY styles.css  /usr/share/nginx/html/styles.css
COPY admin.html  /usr/share/nginx/html/admin.html
COPY admin.js    /usr/share/nginx/html/admin.js
COPY admin.css   /usr/share/nginx/html/admin.css
COPY church.html /usr/share/nginx/html/church.html
COPY church.js   /usr/share/nginx/html/church.js
COPY church.css  /usr/share/nginx/html/church.css

EXPOSE 80
