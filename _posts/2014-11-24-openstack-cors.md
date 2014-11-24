---
layout: post
title: "Enabling CORS in OpenStack APIs"
date: 2014-11-24 13:45:00
comments: true
---

If you plan on building JavaScript applications in the browser that use the OpenStack APIs, you will likely run into issues with the same-origin policy in modern browsers. This is because OpenStack APIs do not natively supply [cross-origin resource sharing (CORS)](http://en.wikipedia.org/wiki/Cross-origin_resource_sharing) headers. However, there are a few ways around this.

## Reverse proxy

If you have a reverse proxy in front of the APIs, it's trivial to add CORS headers to responses. There are a [million](http://enable-cors.org/server.html) [guides](http://oskarhane.com/avoid-cors-with-nginx-proxy_pass/) out on the Internet for this.

## WSGI pipeline

Almost all OpenStack APIs are WSGI applications, and they generally use [paste](http://en.wikipedia.org/wiki/Python_Paste) to assemble the middleware stack for the application. If we just add in middleware that enables CORS, we're all set. I went with [wsgicors](https://github.com/may-day/wsgicors), a dead simple WSGI middleware for CORS headers. Start by installing it on the node that serves the OpenStack APIs.

```bash
pip install wsgicors
```

The next step is to inject the new middleware into the API pipelines. For this example, I'll use Keystone. Edit `/etc/keystone/keystone-paste.ini` and add the following section.

```ini
[filter:cors]
use = egg:wsgicors#middleware
policy = open
open_origin = *
open_headers = *
open_methods = *
open_maxage = 86400
```

Then, add `cors` to the beginning of each `pipeline` section, like so.

```ini
[pipeline:public_api]
pipeline = cors stats_monitoring sizelimit url_normalize build_auth_context token_auth admin_token_auth xml_body_v2 json_body ec2_extension user_crud_extension public_service

[pipeline:admin_api]
pipeline = cors sizelimit url_normalize build_auth_context token_auth admin_token_auth xml_body_v2 json_body ec2_extension s3_extension crud_extension admin_service

[pipeline:api_v3]
pipeline = cors stats_reporting sizelimit url_normalize build_auth_context token_auth admin_token_auth xml_body_v3 json_body ec2_extension_v3 s3_extension simple_cert_extension revoke_extension service_v3

[pipeline:public_version_api]
pipeline = cors sizelimit url_normalize xml_body public_version_service

[pipeline:admin_version_api]
pipeline = cors sizelimit url_normalize xml_body admin_version_service
```

Then restart Keystone with `service keystone restart` (assuming you're on a distro with Upstart or similar).

That's it! Now you should be able to use the OpenStack APIs from the browser. Good luck!
