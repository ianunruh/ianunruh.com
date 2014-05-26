---
layout: post
title: "Sensu and Flapjack"
date: 2014-05-25 19:01:00
comments: true
---

{% include monitoring-series.html %}

In the [previous post](/2014/05/monitor-everything-part-4.html), I started on collection and visualization of metrics using Sensu, Graphite, and Grafana. In this post, I'll cover Sensu service checks and integrating Sensu with [Flapjack](http://flapjack.io/), an alert notification router.

<div class="clearfix"></div>

## Sensu service checks

In the last post, I covered using Sensu to collect metrics. Now I'll cover how to use Sensu in a Nagios-like fashion with service checks. On the client node that we setup in the previous post, install Nginx to play as a web server in production.

```bash
apt-get install -y nginx
```

Then install a Sensu plugin that can be used to check if Nginx is running. Since we're doing that, we might as well gather some metrics from Nginx too! Isn't Sensu awesome?

```bash
gem install sensu-plugin --no-ri --no-rdoc

git clone git://github.com/sensu/sensu-community-plugins.git
cd sensu-community-plugins/plugins

cp nginx/nginx-metrics.sh /etc/sensu/plugins
cp processes/check-procs.rb /etc/sensu/plugins
```

Now add a subscription to the Sensu client called `nginx`.

```json
{
  "client": {
    "name": "app1",
    "address": "192.168.12.11",
    "subscriptions": ["nginx"]
  }
}
```

Restart the Sensu client with `service sensu-client restart`. Over on the Sensu server, create `/etc/sensu/conf.d/nginx.json` with the following contents.

```json
{
  "checks": {
    "nginx_check": {
      "command": "check-procs.rb -p nginx",
      "interval": 30,
      "subscribers": ["nginx"],
      "handlers": []
    },
    "nginx_metrics": {
      "type": "metric",
      "command": "nginx-metrics.rb",
      "interval": 10,
      "subscribers": ["nginx"],
      "handlers": ["relay"]
    }
  }
}
```

Restart Sensu with `service sensu-server restart`.

Now, metrics will be gathered from Nginx and relayed to Graphite every 10 seconds and Sensu will check if Nginx is running every 30 seconds. The Nginx check was configured without any handlers, so at the moment, the only way to see if the check failed is through the Sensu dashboard.

Sensu already has [guides on adding handlers](http://sensuapp.org/docs/0.12/adding_a_handler) for check failures, so instead I'll try to cover something more advanced. Instead of using Sensu's handlers to deliver alerts, I'm going to offload that onto a tool called Flapjack.

## Flapjack

While researching for this blog series, I came across Flapjack, an alert notification router that works with check execution engines like Nagios and Sensu. Despite Sensu having built in notification and rollup, using these features can have [various drawbacks](http://fractio.nl/2014/01/03/the-how-and-why-of-flapjack/) that aren't immediately apparent. The latest iteration of Flapjack was built from the ground up to focus on alert routing. The Unix philosophy of doing one thing and doing it well really appeals to me, so I decided to look into this tool more.

There is an excellent [SpeakerDeck](https://speakerdeck.com/auxesis/finding-signal-in-the-monitoring-noise-with-flapjack) covering the benefits of using Flapjack.

<div class="row">
  <div class="col-md-6">
    <img src="/images/mep5/flapjack1.png" alt="Flapjack screenshot">
  </div>
  <div class="col-md-6">
    <img src="/images/mep5/flapjack-diagram.png" alt="Flapjack architectural diagram">
  </div>
</div>

In my case, I'm integrating Flapjack with Sensu instead of Nagios, so there is no need for the Nagios receiver. Instead, Sensu will be configured to feed check events directly into the Redis queue that is processed by Flapjack.

Install Flapjack using the following script, taken from my [monitoring scripts project](https://github.com/ianunruh/monitoring).

```bash

echo "deb http://packages.flapjack.io/deb precise main" > /etc/apt/sources.list.d/flapjack.list

apt-get update
# Ignore unauthenticated package prompt with --force-yes
apt-get install -y --force-yes flapjack
```

The Flapjack omnibus package includes its own instance of Redis on port 6380. You'll need to adjust `/etc/flapjack/flapjack_config.yaml` to fit your needs.

On the Sensu server, we need to install the Flapjack handler.

```bash
git clone git://github.com/sensu/sensu-community-plugins.git
cp sensu-community-plugins/extensions/handlers/flapjack.rb /etc/sensu/extensions/handlers
```

Create `/etc/sensu/conf.d/flapjack.json` with the following contents. It should match the configuration used by Flapjack to connect to Redis.

```
{
  "flapjack": {
    "host": "localhost",
    "port": 6380,
    "db": "0"
  }
}
```

Let's take the Nginx check from earlier and make some adjustments to it.

```json
{
  "checks": {
    "nginx_check": {
      "type": "metric",
      "command": "check-procs.rb -p nginx",
      "interval": 30,
      "subscribers": ["nginx"],
      "handlers": ["flapjack"]
    }
}
```

Notice that I added the metric type to this check. This is because we want to feed all check results to Flapjack, including successful ones.

After restarting the Sensu server, you should be able to see check results flowing into the Flapjack web interface on port 3080. If you want to test out a failure, you can either use the `simulate-failed-check` tool included with Flapjack, or create some havok yourself with `service nginx stop`.



## Wrap-up

In this post, I covered ways to improve this monitoring solution. Using Graphite functions, I cleaned up different metrics on Grafana to make it easier to ascertain the state of my applications. I added service checks to Sensu to provide alerting of failures, then fed the check results into Flapjack, an alert notification router.
