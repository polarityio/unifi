# Polarity UniFi Network Integration

Polarity's UniFi Network integration queries your on-premise UniFi Network controller for **IPv4 addresses** and **MAC addresses**, returning real-time information about connected clients and infrastructure devices (access points, switches, gateways) across **all sites** in your controller.

From the overlay, analysts can **block** or **reconnect** suspicious clients without leaving their workflow.

## Supported Entity Types

| Entity Type | Description |
|---|---|
| `IPv4` | Looks up client connections and infrastructure devices by IP address |
| `MAC Address` | Looks up client connections and infrastructure devices by MAC address |

## Features

| Feature | Detail |
|---|---|
| **Multi-site** | Automatically enumerates all sites in your controller on first lookup; results are shown per site |
| **Client lookup** | Shows hostname, IP, MAC, type (WIRED/WIRELESS/VPN), status (CONNECTED/BLOCKED), SSID, uptime, traffic stats, signal strength |
| **Device lookup** | Shows name, model, product line, firmware version, state (ONLINE/OFFLINE/UPDATING) for APs, switches, and gateways |
| **Block / Reconnect** | One-click block or reconnect of suspicious clients directly from the Polarity overlay |
| **Site cache** | Site list is cached for 1 hour to minimize API calls |

## UniFi Controller Setup

### Supported Controller Versions

This integration supports on-premise UniFi Network controllers running version **10.3.58 or later** with the new API (`/proxy/network/integration`).

### Generating an API Key

1. Log in to your UniFi Network controller
2. Navigate to **Settings → Admins & Users → API**  
3. Click **Create API Key** and copy the key
4. The API Key needs at minimum: **read access** to sites, clients, and devices; **write access** to execute client actions (block/reconnect)

### Controller URL Format

The URL must point to the integration API base path:

```
https://{your-controller-host}/proxy/network/integration
```

**Examples:**
- `https://192.168.1.1/proxy/network/integration`
- `https://unifi.company.com/proxy/network/integration`

> ⚠️ The URL must **not** end with a trailing slash.

## Integration Options

| Option | Description | Admin Only |
|---|---|---|
| **UniFi Controller URL** | Base URL of your on-premise UniFi controller (no trailing slash) | ✅ |
| **API Key** | Your UniFi Network API Key | ✅ |
| **Ignored Entities** | Comma-separated list of IPs or MACs to skip | ❌ |
| **IP Blocklist Regex** | Regular expression for IPs to exclude from lookup | ❌ |

## Block / Reconnect Actions

When a **connected client** is found in an overlay result:

- **⛔ Block Client** — sends a `block` action to the UniFi controller, preventing the client from accessing the network. The status updates to `BLOCKED` immediately in the overlay.
- **🔄 Reconnect** — sends a `reconnect` action to restore the client's network access. The status updates to `CONNECTED` immediately in the overlay.

> Infrastructure devices (access points, switches, gateways) do **not** have action buttons in V1 — they are read-only.

## Multi-Site Behavior

On the first lookup after startup (or after the 1-hour cache expires), the integration fetches the full list of sites from `GET /v1/sites`. All subsequent lookups fan out across every site in parallel, running both client and device queries per site.

Results are grouped by site in the overlay:
- Each client match appears in a **🖥 Connected Client — {site name}** collapsible section
- Each device match appears in a **📡 Infrastructure Device — {site name}** collapsible section

## Installation

1. Clone or download this integration into your Polarity integrations directory
2. Run `npm install`
3. Configure the **UniFi Controller URL** and **API Key** in Polarity's integration settings

## About Polarity

Polarity is a memory-augmentation platform that automatically overlays relevant contextual information onto any system—browser, terminal, email client, and more—so analysts can act on intelligence without switching tools.

[https://polarity.io](https://polarity.io)
