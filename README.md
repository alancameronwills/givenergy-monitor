# Solar PV monitor and weather forecast display

This app is in two parts:

* A server that interrogates the GivEnergy inverter on the local network
  - Provides a bridge from the MODBUS TCP protocol to REST API
  - Serves client pages
* A client that displays a chart of the current state of the inverter and battery
  - Also shows the current weather forecast

The user interface is a web page running on Chrome. 

The client and server are intended to run in the same machine, a Raspberry Pi running Debian Linux with a small display.
The client displays http://localhost:6345
The server runs on Node.js.

The master copy of the code is kept in GitHub at https://github.com/alancameronwills/givenergy-monitor 

Content of this directory:

* run.sh - start the server and the client. Called on power up.
* scan.js - Finds the inverter on the local network
*	server.js - Serves the client files and bridges to the inverter
* public/
  *	pv.html - the UI
  * givenergy.js - Gets and parses the inverter state, displays a chart
  * weather.js - Gets and parses the weather forecast, displays a chart

* fetch-code.sh	- Gets latest code from GitHub
* READ_ME.md	- This file

* ~/.config/autostart/run-monitor.desktop - X-Windows config file starts run.sh on power up :
```
[Desktop Entry]
Name=Fullscreen browser
Exec=/home/alan/givenergy-monitor/run.sh
Type=Application
```