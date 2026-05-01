function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const weatherDays = 5;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weatherCodes = ["dry", "", "", "", "fog", "drizzle", "rain", "snow", "showers", "thunder"];
class HourlyArrayGetter {
    constructor(rawWeather, name) {
        this.part = rawWeather.hourly?.[name] || [];
        this.ix = 0;
    }
    next() {
        if (!this.part) return "";
        if (this.ix > this.part.length) return "";
        return this.part[this.ix++];
    }
    moveOn(n) {
        this.ix += n;
    }
    nextAverageOf(n) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < n; i++) {
            let vs = this.next();
            if (vs.length == 0) break;
            count++;
            sum += +vs;
        }
        if (count == 0) return 0;
        return sum / count;
    }
    nextProbWetOf(n) {
        let probNotWet = 1;
        let count = 0;
        for (let i = 0; i < n; i++) {
            let vs = this.next();
            if (vs.length == 0) break;
            count++;
            let probNotWetThisHour = (100 - (+vs)) / 100;
            probNotWet = probNotWet * probNotWetThisHour;
        }
        return (1 - probNotWet) * 100;
    }
    nextMaxOf(n) {
        let max = -10000;
        for (let i = 0; i < n; i++) {
            let vs = this.next();
            if (vs.length == 0) break;
            let v = +vs;
            if (v > max) max = v;
        }
        return max;
    }
    nextMinOf(n) {
        let min = 10000;
        for (let i = 0; i < n; i++) {
            let vs = this.next();
            if (vs.length == 0) break;
            let v = +vs;
            if (v < min) min = v;
        }
        return min;
    }
    dominant360(n) {
        let d = new Array(n);
        let count = 0;
        for (let i = 0; i < n; i++) {
            let vs = this.next();
            if (vs.length == 0) break;
            count++;
            d[i] = +vs;
        }
        let minpc = 100000;
        let minpcix = 0;
        for (let i = 0; i < count; i++) {
            let pc = 0;
            for (let j = 0; j < count; j++) {
                let diff = Math.abs(d[i] - d[j]);
                pc += diff > 180 ? 360 - diff : diff;
            }
            if (pc < minpc) {
                minpc = pc;
                minpcix = i;
            }
        }
        return d[minpcix];
    }
}

class WeatherDay {
    constructor(date, tMax, tMin, speed, speedN, direction, directionN, precip, precipN, code) {
        this.fcDate = date;
        this.tempMin = tMin;
        this.tempMax = tMax;
        this.windDirection = direction;
        this.windDirectionN = directionN;
        this.windSpeed = speed;
        this.windSpeedN = speedN;
        this.precip = precip;
        this.precipN = precipN;
        this.weather = code;
    }
    report() {
        return `${this.fcDate} ${this.tMin}..${this.tMax} ${this.speed} ${this.precip}%..${this.precipN}% ${this.weather}`;
    }
};
function d2(n) {
    return n < 10 ? "0" + n : "" + n;
}
class Weather {
    constructor(location) {
        this.location = location || [52.06, -4.75];
        this.rawWeather = null;
        this.rawWeatherTimestamp = 0;
    }
    async getRawWeather() {
        if (!this.rawWeather || Date.now() - this.rawWeatherTimestamp  > 60*60*1000) {
            const [lat, lon] = this.location; //[52.06, -4.75];
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&` +
                "hourly=weather_code,temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,global_tilted_irradiance&tilt=50&azimuth=-10&timezone=auto";
            try {
                this.rawWeather = await fetch(url).then(r => r.json());
                // this.rawWeather = await fetch("https://pantywylan-2.azurewebsites.net/api/weather?q=74z5iz8nzam").then(r => r.json());
                this.rawWeatherTimestamp = Date.now();
            }
            catch { }
        }
        return this.rawWeather;
    }

    /**
     * Hourly forecast 48h from start of today
     * @returns Array of {dt: time iso, t: temp C, p: precip %, s: sun [0..1000]}
     */
    async h24() {
        let weather = await this.getRawWeather();
        let dateGetter = new HourlyArrayGetter(weather, "time");
        let tempGetter = new HourlyArrayGetter(weather, "temperature_2m");
        let precipGetter = new HourlyArrayGetter(weather, "precipitation_probability");
        let sunGetter = new HourlyArrayGetter(weather, "global_tilted_irradiance");
        let _h24 = [];
        for (let i = 0; i < 48; i++) {
            let dt = dateGetter.next();
            if (!dt) break;
            _h24.push({ dt: dt, t: tempGetter.next(), p: precipGetter.next(), s: sunGetter.next() });
        }
        return _h24;
    }
    async daily() {
        let weather = await this.getRawWeather();
        let dateGetter = new HourlyArrayGetter(weather, "time");
        let tempGetter = new HourlyArrayGetter(weather, "temperature_2m");
        let speedGetter = new HourlyArrayGetter(weather, "wind_speed_10m");
        let directionGetter = new HourlyArrayGetter(weather, "wind_direction_10m");
        let precipGetter = new HourlyArrayGetter(weather, "precipitation_probability");
        let codeGetter = new HourlyArrayGetter(weather, "weather_code");

        let forecast = [];

        // Move each cursor to first 6am
        for (let s = dateGetter.next(); s.length == 0 || s.indexOf("T06:") < 0; s = dateGetter.next()) {
            tempGetter.next();
            speedGetter.next();
            directionGetter.next();
            precipGetter.next();
            codeGetter.next();
        }
        for (let i = 0; i < weatherDays; i++) {
            let dt = dateGetter.next();
            if (!dt) break;
            dateGetter.moveOn(23);
            forecast.push(new WeatherDay(
                dt.substring(0, 10),
                tempGetter.nextMaxOf(12),
                tempGetter.nextMinOf(12),
                speedGetter.nextAverageOf(12),
                speedGetter.nextAverageOf(12),
                directionGetter.dominant360(12),
                directionGetter.dominant360(12),
                precipGetter.nextProbWetOf(12),
                precipGetter.nextProbWetOf(12),
                weatherCodes[Math.floor(codeGetter.nextAverageOf(24) / 10)],
            ));
        }
        return forecast;
    }
}

class WeatherGraph {
    constructor(div, vscale, hsize, weather) {
        this.div = div;
        this.weather = weather;
        this.vscale = vscale;
        this.hsize = hsize;
        this.forecast = null;
        this.offset = 3 * this.vscale;
    }
    css() {
        return `<style>
        .weather {
            font-family: Arial, Helvetica, sans-serif;
            clip-path: margin-box;
            padding-left: 20px;
            font-family: sans-serif;
            color: gray;
            width: 300px;

            .day-label {
                color: gray;
            }

            .days {
                display: flex;
                justify-content: space-around;
                width: 100%;
            }

            .bars {
                display: flex;
                align-items: flex-end;
                justify-content: space-around;
                width: 100%;
            }

            .bars>div {
                display: flex;
                justify-content: space-evenly;
                width: ${100 / this.forecast.length * 2 - 2}%;
            }

            .bar {
                position: relative;
                width: 10px;
                background-color: hsl(55, 100%, 75%);
                margin: 4px;
            }

            .scale {
                transform: translate -100%;
                width: 100%;
                position: absolute;
            }

            .scale>.hr {
                border-bottom: solid lightgrey 1px;
                position: absolute;
                width: 100%;
                margin-left: -20px;
            }
        }
                </style>`;
    }
    h(t) { return Math.round(Math.abs(t) * this.vscale); }
    b(t) { return Math.round(this.offset + Math.min(0, t * this.vscale)); }
    barColour(hue, rain) { return `hsl(${hue},100%,${Math.round((100 - rain) * 0.6 + 20)}%)`; }
    async drawTempBars() {
        let maxT = -10;
        let s = "<div class='weather'><div class='bars'>";
        this.forecast = await this.weather.daily();
        for (const day of this.forecast) {
            let rain = +day.precip;
            let rainN = +day.precipN;
            let width = Math.round(Math.min(18, 4 + day.windSpeed / 3));
            let widthN = Math.round(Math.min(18, 4 + day.windSpeedN / 3));
            s +=
                `<div>
                        <div class='bar' style='height:${this.h(day.tempMax)}px;margin-bottom:${this.b(day.tempMax)}px;width:${width}px;background-color:${this.barColour(55, rain)};'></div>
                    </div>
                    <div>
                        <div class='bar night' style='height:${this.h(day.tempMin)}px;margin-bottom:${this.b(day.tempMin)}px;width:${widthN}px;background-color:${this.barColour(194, rainN)};'></div>
                    </div>`;
            maxT = Math.max(maxT, day.tempMax, day.tempMin);
        }
        s += "</div>";
        s += "<div class='scale'>";
        for (let t = 0; t < maxT + 10; t += 5) {
            s += `<div class="hr" style='bottom:${this.h(t) + this.b(0)}px' >${t}</div>`;
        }

        s += "</div>";
        let firstDay = new Date(this.forecast[0].fcDate).getDay();
        s += "<div class='days'>";
        for (let di = 0; di < this.forecast.length; di++) {
            s += `<div class="day-label">${dayNames[(firstDay + di) % 7]}</div>`;
        }
        s += "</div>";
        s += "<center><i><small>dark=rainy, wide=windy</small></i></center>";
        s += "</div>";
        this.div.innerHTML = this.css() + s;
    }
    async drawWithRetry() {
        for (let i = 0; i < 3; i++) {
            try {
                await this.drawTempBars();
                break;
            } catch {
                await sleep(60000);
            }
        }
    }
}
class DayChart {
    constructor(dayChartDiv, width, weather) {
        this.div = dayChartDiv;
        this.width = width;
        this.weather = weather;
    }
    async draw() {
        let hours = await this.weather.h24();
        let now = Date.now();
        let content = `<style>.dayStripe {display:flex;width:100%;position:absolute}
                        .dayStripe>div{position:relative;height:5px;width:4%; border-left:solid blue 1px;}
                        .dayStripe>div.time{border-bottom:solid red 3px;}
                        .mark{position:absolute;width:1px; top:100%; right:-2px; height:200%; border:solid limegreen 1px;}
                        </style>`;
        content += "<div class='dayStripe'>";
        let currentTimeValue = new Date().valueOf();
        let currentTimeMarked = false;
        for (let i = 0; i < 24; i++) {
            if (hours[i]?.dt && hours[i + 1]) {
                let dt = new Date(hours[i].dt);
                let markCurrentTime = false;
                if (!currentTimeMarked) {
                    if (dt.valueOf() > currentTimeValue) {
                        currentTimeMarked = true;
                        markCurrentTime = true;
                    }
                }
                let lum = Math.min(100, 15 + Math.round(5 * hours[i + 1].s) / 60);
                // Figures are for prior hour, so e.g. midday figures are shown at 13:00
                let mark = dt.getHours() % 6 == 0 ? "<div class='mark'></div>" : "";
                content += `<div style='background-color:hsl(60,100%,${lum}%)' ${markCurrentTime ? "class='time'" : ""}>${mark}</div>`;
            }
        }
        content += "</div>";
        this.div.innerHTML = content;
    }
    async drawWithRetry() {
        for (let i = 0; i < 3; i++) {
            try {
                await sleep(5000);
                await this.draw();
                break;
            } catch {
                await sleep(60000);
            }
        }
    }
}
function doNowAndOnHour(f) {
    f();
    let updateTime = new Date().getMinutes();
    setTimeout(() => {
        f();
        setInterval(() => { f(); }, 60 * 60 * 1000);
    }, (60 - updateTime) * 60 * 1000);
}
function showWeather(weatherDivId, dayChartDivId) {
    let weather = new Weather();
    let graph = new WeatherGraph(document.querySelector("#" + weatherDivId), 10, 300, weather);
    graph.drawWithRetry();
    if (dayChartDivId) {
        let dayChart = new DayChart(document.querySelector("#" + dayChartDivId), 300, weather);
        doNowAndOnHour(() => { dayChart.drawWithRetry() });
    }
}