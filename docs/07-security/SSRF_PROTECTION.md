# SSRF Protection
Outbound webhook deliveries use a custom `safeFetch` implementation.
It includes protections against private, loopback, and link-local IP destinations.

**KNOWN LIMITATION**: `safeFetch` as implemented is vulnerable to DNS TOCTOU (Time-of-Check to Time-of-Use) rebinding attacks. A potential future mitigation would be routing traffic through an enterprise proxy, but this is NOT currently implemented.
