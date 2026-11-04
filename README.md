# XGB430v unlock

[![Instalar con Tampermonkey](https://img.shields.io/badge/Instalar%20con-Tampermonkey-00485B?logo=tampermonkey&logoColor=white)](https://raw.githubusercontent.com/tasarren/digi-router-unlocker/main/unlock.user.js)
[![Instalar con Violentmonkey](https://img.shields.io/badge/Instalar%20con-Violentmonkey-F26B1F)](https://raw.githubusercontent.com/tasarren/digi-router-unlocker/main/unlock.user.js)
[![Descargar .user.js](https://img.shields.io/badge/Descargar-.user.js-2ea44f)](https://raw.githubusercontent.com/tasarren/digi-router-unlocker/main/unlock.user.js)

[English](README-en.md)

Desbloquea todos los menús escondidos de la interfaz web del **Digi TP-Link XGB430v Pro** (XGS-PON BE7200
Wi-Fi 7): QoS, Security, VPN, los ajustes de GPON WAN, 3G/4G, Firewall completa, SFU VLAN, CATV, Application List,
TR-369, Telnet, SSH...

En resumen, todo lo que no te deja ver la cuenta que el operador te ha restringido.

Probado en: **Digi TP-Link XGB430v Pro, hardware v1.0, firmware `0.2.0 3.2.1 v60c3.0 Build 250808 Rel.72518n`**
(`Hardware Version:XGB430v Pro v1.0`). Con otras revisiones de hardware o firmware no he podido probar;
puede que funcionen y puede que no, abrid un issue si no os funciona.

![widget-digi-unlocker](screenshots/widget.png)

| Con el script                                         | Por defecto (ISP)                                     |
|-------------------------------------------------------|-------------------------------------------------------|
| ![advanced patched](screenshots/widget-loaded.png) | ![advanced default](screenshots/advanced-default.png) |

## Instalación

Dos maneras:

**A. Gestor de userscripts (Tampermonkey / Violentmonkey)**

1. Instala la extensión en el navegador.
2. Crea un script nuevo, pega lo que hay en `unlock.user.js` y guarda.
3. Abre la interfaz del router y recarga.

**B. Extensión de navegador (Manifest V3)**

1. Abre `chrome://extensions` (o `edge://extensions`).
2. Activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta de este repositorio (la que tiene el `manifest.json`).

El manifest se encarga de inyectar `unlock.user.js` en `document_start`, en el mundo `MAIN` de la página y
en todos los frames; hace falta esa combinación para que se ejecute antes de que `oid_str.js` congele el
flag.

## Cambiar la IP del router

El script solo se ejecuta donde se le indique. De fábrica es `192.168.1.1`; si tu router va con otra (míralo en la
etiqueta del aparato o en tu puerta de enlace por defecto: `ip route`, `ipconfig /all`,
Ajustes → Red), cámbiala en los dos sitios:

**1. `unlock.user.js`, líneas 4 y 5:**

```js
// @match        http://192.168.1.1/*
// @match        https://192.168.1.1/*
```

Cambia `192.168.1.1` por la IP de tu router en las dos líneas; por ejemplo:

```js
// @match        http://192.168.0.1/*
// @match        https://192.168.0.1/*
```

**2. `manifest.json`, línea 8:** lo mismo, el `matches` pasa de

```json
"matches": [
  "http://192.168.1.1/*",
  "https://192.168.1.1/*"
]
```

a, por ejemplo:

```json
"matches": [
  "http://192.168.0.1/*",
  "https://192.168.0.1/*"
]
```

**3. Recarga:** si vas por userscript, reinstálalo o actívalo de nuevo; si vas por extensión, pulsa el
botón de recargar. Después, recarga la página del router.

## Qué hace

El firmware trae unos 1600 flags de features (`INCLUDE_*`) dentro de `js/oid_str.js`. Uno de ellos,
`INCLUDE_USER_RESTRICTION`, es el que esconde los menús a la cuenta restringida, y el firmware lo congela
en arranque:

```js
Object.defineProperty(window, 'INCLUDE_USER_RESTRICTION', {value: 1, writable: false});
```

Al ser non-configurable, ni las devtools ni los bookmarklets lo pueden tocar ya cargada la página. Así que
este proyecto se mete **antes** de que se ejecute `oid_str.js` y reescribe esa única llamada a
`defineProperty`:

```js
const define = Object.defineProperty;
Object.defineProperty = function (target, prop, descriptor) {
    if (target === window && prop === 'INCLUDE_USER_RESTRICTION') {
        descriptor = {value: 0, writable: true, configurable: true};
    }
    return define(target, prop, descriptor);
};
```

## Recomendaciones: que el operador no se meta

El script solo cambia lo que pinta el navegador. El operador, en cambio, sigue teniendo un canal de
gestión dentro del router (TR-069/CWMP) desde el que puede hacer cambiosm deshacer los tuyos o trastear sin que te
enteres como subir de firmware etc.Antes de tocar nada:

1. **Déjale apagada la gestión remota**: Administration → "Manage this Router via the Address". Desactívala.
2. **Apaga el TR-069 / ACS** si tu firmware deja esa opción (búscalo como TR-069 o CWMP por Network o
   Management). Es el canal que usa el operador para aprovisionar la caja y deshacer lo que tú cambies.
3. **Ponle una contraseña de administrador fuerte** en Administration mientras estás ahí.

Recuerda: todo esto es del lado del cliente; la política del servidor del operador manda.


### Desbloqueado vs. por defecto

| Desbloqueado (script)                                                                                                                                                                                                                                | Por defecto (ISP)                                  |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| **Basic → Internet**: la entrada del menú para montar la conexión WAN/4G                                                                                                                                                                             | no aparece Internet en ningún sitio del menú Basic |
| **Basic → USB Sharing → 3G/4G Settings**: ajustes del módem USB (APN, PIN, número de marcado, marcado manual)                                                                                                                                        | en USB Sharing solo está USB Storage Device        |
| **Network → Internet**: página de conexión de banda ancha / WAN                                                                                                                                                                                      | no está la entrada                                 |
| **Network → GPON WAN**: página del servicio XGS-PON (GPON Settings: PPPoE `pppoe_gpon_20_1`, VLAN 20, IPoE)                                                                                                                                          | no está la entrada y la página no se puede abrir   |
| **Network → Static Routing**: tabla de rutas estáticas (añadir, modificar, borrar)                                                                                                                                                                   | no está la entrada                                 |
| **Network → RIP Settings**: configuración del protocolo RIP                                                                                                                                                                                          | no está la entrada                                 |
| **Network**: submenú completo (Internet, GPON WAN, GPON Settings, LAN Settings, Dynamic DNS, Static Routing, RIP)                                                                                                                                    | solo quedan LAN Settings y Dynamic DNS             |
| **QoS**: sección en el menú con su página Traffic Control (VoIP QoS, bandas de prioridad High 60% / Middle 30% / Low 10% y lista de reglas QoS por dispositivo)                                                                                      | no hay menú QoS                                    |
| **VPN**: sección en el menú con las páginas de servidor OpenVPN, PPTP VPN, IPSec VPN y VPN Connections                                                                                                                                               | no hay menú VPN                                    |
| **Telephony**: submenú al completo; se añaden Telephone Book, Digit Map, DND & Call Blocking y Call Forwarding                                                                                                                                       | solo Telephone Number y Call Log                   |
| **System Tools → Firmware Upgrade**: página de actualización con las versiones de hardware/firmware y el número de serie                                                                                                                             | no está la entrada                                 |
| **System Tools → System Log**: visor de registros con filtrado y exportación                                                                                                                                                                         | no está la entrada                                 |
| Igual en los dos: Status, Network Map, Wireless, Guest Network, Multi-SSID, Telefonía básica, NAT Forwarding (ALG, Virtual Servers, Port Triggering, DMZ, UPnP), USB Storage Device, Parental Controls, Security, Diagnostics, Administration y Mesh | todo eso funciona sin el script                    |

## Capturas

| Página                    | Script                                                                                                                                                                      | Por defecto                                                                                                                                 |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| VPN                       | <a href="screenshots/adv-vpn-patched.png"><img src="screenshots/adv-vpn-patched.png" width="240" alt="vpn patched" /></a>                                                   | No disponible                                                                                                                               |
| Enrutamiento estático     | <a href="screenshots/adv-network-static-routing-patched.png"><img src="screenshots/adv-network-static-routing-patched.png" width="240" alt="static routing patched" /></a>  | No disponible                                                                                                                               |
| Tráfico QoS               | <a href="screenshots/adv-qos-traffic-patched.png"><img src="screenshots/adv-qos-traffic-patched.png" width="240" alt="qos patched" /></a>                                   | No disponible                                                                                                                               |
| GPON WAN                  | <a href="screenshots/adv-network-gpon-patched.png"><img src="screenshots/adv-network-gpon-patched.png" width="240" alt="gpon patched" /></a>                                | No disponible                                                                                                                               |
| RIP                       | <a href="screenshots/adv-network-rip-patched.png"><img src="screenshots/adv-network-rip-patched.png" width="240" alt="rip patched" /></a>                                   | No disponible                                                                                                                               |
| Registros                 | <a href="screenshots/adv-logs-patched.png"><img src="screenshots/adv-logs-patched.png" width="240" alt="logs patched" /></a>                                                | No disponible                                                                                                                               |
| Actualización de firmware | <a href="screenshots/adv-firm-update-patched.png"><img src="screenshots/adv-firm-update-patched.png" width="240" alt="firmware patched" /></a>                              | No disponible                                                                                                                               |
| Router 4G                 | <a href="screenshots/adv-4g-router-patched.png"><img src="screenshots/adv-4g-router-patched.png" width="240" alt="4g patched" /></a>                                        | No disponible                                                                                                                               |
| 4G (Basic)                | <a href="screenshots/4g-router-patched.png"><img src="screenshots/4g-router-patched.png" width="240" alt="4g basic patched" /></a>                                          | No disponible                                                                                                                               |
| Puertas de enlace         | <a href="screenshots/adv-network-gateways-patched.png"><img src="screenshots/adv-network-gateways-patched.png" width="240" alt="gateways patched" /></a>                    | No disponible                                                                                                                               |
| Lista de contactos        | <a href="screenshots/adv-telephony-book-patched.png"><img src="screenshots/adv-telephony-book-patched.png" width="240" alt="phone book patched" /></a>                      | No disponible                                                                                                                               |
| Desvío de llamadas        | <a href="screenshots/adv-telephony-call-forward-patched.png"><img src="screenshots/adv-telephony-call-forward-patched.png" width="240" alt="call forwarding patched" /></a> | No disponible                                                                                                                               |
| DND y bloqueo de llamadas | <a href="screenshots/adv-telephony-dnd-call-block-patched.png"><img src="screenshots/adv-telephony-dnd-call-block-patched.png" width="240" alt="dnd patched" /></a>         | No disponible                                                                                                                               |
| Avanzado                  | <a href="screenshots/advanced-patched.png"><img src="screenshots/advanced-patched.png" width="240" alt="advanced patched" /></a>                                            | <a href="screenshots/advanced-default.png"><img src="screenshots/advanced-default.png" width="240" alt="advanced default" /></a>            |
| Inicio                    | <a href="screenshots/home-patched.png"><img src="screenshots/home-patched.png" width="240" alt="home patched" /></a>                                                        | <a href="screenshots/home-default.png"><img src="screenshots/home-default.png" width="240" alt="home default" /></a>                        |
| Administración            | <a href="screenshots/adv-admin-patched.png"><img src="screenshots/adv-admin-patched.png" width="240" alt="admin patched" /></a>                                             | <a href="screenshots/adv-admin-default.png"><img src="screenshots/adv-admin-default.png" width="240" alt="admin default" /></a>             |
| Telefonía                 | <a href="screenshots/adv-telephony-patched.png"><img src="screenshots/adv-telephony-patched.png" width="240" alt="telephony patched" /></a>                                 | <a href="screenshots/adv-telephony-default.png"><img src="screenshots/adv-telephony-default.png" width="240" alt="telephony default" /></a> |

"No disponible" quiere
decir que la página está escondida por defecto por la restricción del operador, así que no existe captura
por defecto.