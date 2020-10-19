
# Controller - Chromecast / Chromecast Audio  

This accessory will discover all chromecasts on the network and create a lightbulb for 'Chromecast', 'Chromecast Audio', 'Google Cast Group', 'JBL Link View', 'Lenovo Smart Display', 'Google Nest Hub', 'Lenovo Smart Clock', 'Google Home', 'Google Home Mini', 'Google Nest Mini'.  
  
Turning the bulb On/Off  will play/pause the currently casted stream.  
Setting the brightness will set the volume of the device.

## Installation

```sh
npm i -g homebridge-control-chromecast
```
  
Add this to your config.json.
  
```json
"platforms":[
    {
      "platform" : "ControlChromecast",
      "name" : "Chromecast"
    }
]
```
  
## Configuration options  

The bulb has the following properties:
  
| Attribute | Required | Usage | Example |
|-----------|----------|-------|---------|
| ignoredDevices | no | The name of your Chromecast device as shown in your Google Home App (case insensitive). This will ignore the device and controller will not be added. | ["Living Room","Bedroom TV"] |

## Credits
This project as been largely inspired by the work of [@robertherber](https://bitbucket.org/robertherber/homebridge-chromecast/src) and [@paolotremadio](https://github.com/paolotremadio/homebridge-automation-chromecast)
