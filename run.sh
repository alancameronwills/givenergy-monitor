#!/bin/bash
cd `dirname $BASH_SOURCE`
sleep 30s
( ./fetch-code.sh; npm start ) &> server.log &
(sleep 25s; chromium-browser --kiosk --no-first-run --disable-infobars --disable-pinch --start-fullscreen --disk-cache-size=1 --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling http://localhost:6345/pv.html?nocursor)
read -t 20 -p "--"
