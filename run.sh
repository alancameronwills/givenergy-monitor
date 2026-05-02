#!/bin/bash
cd `dirname $BASH_SOURCE`
sleep 30s
( ./fetch-code.sh; npm start ) &> server.log &
(sleep 25s; chromium-browser --kiosk --no-first-run --disable-infobars --disable-pinch --start-fullscreen --disk-cache-size=1 http://localhost:6345/pv.html?nocursor) 
read -t 20 -p "--"
