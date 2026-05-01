#!/bin/bash
cd `dirname $BASH_SOURCE`
./fetch-code.sh
node ./scan.js
node ./server.js &
(sleep 5s; chromium-browser --kiosk --no-first-run --disable-infobars --disable-pinch --start-fullscreen --disk-cache-size=1 http://localhost:6345/pv.html/?nocursor) 
read -t 30 -p "--"
