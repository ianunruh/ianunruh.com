---
layout: post
title: "Monitoring Everything (Part 4)"
date: 2014-05-16 23:29:00
comments: true
---

In the first three posts of this series, I covered the architecture and configuration of Logstash. Combining Logstash, Elasticsearch and Kibana gives you a centralized view of your infrastructure's logs. However, to gain insight into performance of various components, we need to go a step further. This part of the series will deal with collecting and visualizing various metrics from your infrastructure, using Sensu and Graphite.

Below is the architecture we'll end up with after installing and wiring up everything in this post. You can merge any sort of log aggregration architecture discussed in the [previous post](/2014/05/monitor-everything-part-3.html) with it.

![Overall architecture](/images/mep4/overall.png)

The installation instructions in this post have been tested on Ubuntu Server 14.04, but may work on earlier releases.

***

## Graphite

[Graphite](http://graphite.readthedocs.org/en/latest/) is used to filter and store arbitrary metrics for later use. It is made up of two major components.

1. backend daemon called Carbon that receives, relays, aggregates and stores metrics from various sources
2. frontend Django web app that exposes the stored metrics.

Graphite does not provide a facility for collecting metrics, it only receives metrics. This is left up to other tools in the stack.

### Installation

The first step is installing Carbon. The default configuration for Carbon is suitable for our needs, though you may want to [adjust the retention rates](http://graphite.readthedocs.org/en/latest/config-carbon.html).

```bash
apt-get install -y graphite-carbon

echo "CARBON_CACHE_ENABLED=true" > /etc/default/graphite-carbon

service carbon-cache start
```

Now install the web frontend.

```bash
apt-get install -y graphite-web apache2 apache2-mpm-worker libapache2-mod-wsgi

# Prepare and migrate the SQLite database
chown _graphite /var/lib/graphite
sudo -u _graphite graphite-manage syncdb --noinput

# Configure httpd
rm -f /etc/apache2/sites-enabled/000-default.conf
cp /usr/share/graphite-web/apache2-graphite.conf /etc/apache2/sites-enabled/graphite.conf
service apache2 restart
```

Usually it is [recommended](http://obfuscurity.com/2013/12/Why-You-Shouldnt-use-SQLite-with-Graphite) to use an external database (like PostgreSQL) for the Graphite dashboard instead of the built-in SQLite database. However, since we'll be using Grafana primarily, SQLite will work just fine.

***

## Grafana

[Grafana](http://grafana.org/) is a beautiful, alternative dashboard for Graphite. It uses Elasticsearch to store dashboards, so we'll start by installing that.

```bash
curl -s http://packages.elasticsearch.org/GPG-KEY-elasticsearch | apt-key add -
echo "deb http://packages.elasticsearch.org/elasticsearch/1.0/debian stable main" > /etc/apt/sources.list.d/elasticsearch.list

apt-get update
apt-get install -y elasticsearch openjdk-7-jre-headless
update-rc.d elasticsearch defaults

service elasticsearch start
```

Now for Grafana, which we'll host side-by-side with Graphite web on Apache.

```bash
curl -O -L http://grafanarel.s3.amazonaws.com/grafana-1.5.3.tar.gz
tar xf grafana-1.5.3.tar.gz
cp -R grafana-1.5.3 /usr/share/grafana

echo "alias /grafana /usr/share/grafana" > /etc/apache2/sites-enabled/grafana.conf

service apache2 restart
```

You'll also need to adjust `/usr/share/grafana/config.js`. By default, it looks for Graphite web on port 8080, but we set it up on port 80. If you choose to move Elasticsearch off to its own node, you'll need to change that as well.

This approach is far easier than most tutorials I've seen, thanks to the new Graphite packages included in Ubuntu 14.04. So, now we have Graphite up and running, but no metrics are flowing. This is where Sensu comes in.

***

## Sensu

[Sensu](http://sensuapp.org/) looks very promising in the field of monitoring tools. It has a slim Ruby codebase and is easily configurable. It provides two primitives, checks and metrics. You can use checks to provide traditional service checks and alerts (similar to Nagios and other classical monitoring systems). Metrics, on the other hand, can be used to collect any sort of data from a node for a given interval.

### Installation

I'm not going to cover the installation of Sensu, as they have an amazing [getting started guide](http://sensuapp.org/docs/0.12/guide) available. I've also put together [a set of scripts](https://github.com/ianunruh/monitoring) that you can use to perform unattended installations of Sensu using your favorite configuration management tool.

### WizardVan

This part assumes you have flowed the basic installation guide for Sensu and your client and server are talking.

Before we can start collecting metrics, we have to tell Sensu what to do with them. This is where [WizardVan](https://github.com/opower/sensu-metrics-relay) comes into play. It will take incoming metrics and relay them to Carbon for processing and storage.

```bash
apt-get install -y git

git clone git://github.com/opower/sensu-metrics-relay.git
cd sensu-metrics-relay
cp -R lib/sensu/extensions/* /etc/sensu/extensions
```

Create `/etc/sensu/conf.d/relay.json` with the following contents.

```json
{
  "relay": {
    "graphite": {
      "host": "localhost",
      "port": 2003
    }
  }
}
```

Restart the Sensu server with `service sensu-server restart`.

### Collecting metrics

We'll need to put a metric and client in the same subscription. I've chosen `production` here, but use whatever make sense for your environment. Configure your client with the following stanza in `/etc/sensu/conf.d/client.json`.

```json
{
  "client": {
    "name": "portland",
    "address": "192.168.44.11",
    "subscriptions": ["production"]
  }
}
```

Then on the server, create `/etc/sensu/conf.d/metrics.json` with the following.

```json
{
  "checks": {
    "load_metrics": {
      "type": "metric",
      "command": "load-metrics.rb",
      "subscribers": ["production"],
      "handlers": ["relay"],
      "interval": 10
    }
  }
}
```

The `load-metrics.rb` command does not come with Sensu. It actually comes from the Sensu community plugins repository, so we'll need to install it.

```bash
git clone git://github.com/sensu/sensu-community-plugins.git
cp sensu-community-plugins/plugins/system/load-metrics.rb /etc/sensu/plugins
```

Plugins can be written in any language, since they're just an external program that Sensu calls every interval. However, most Sensu plugins are written in Ruby and use the excellent `sensu-plugin` gem. This means we have to do some extra work when first installing plugins.

In particular, the `load-metrics.rb` plugin requires us to do the following on the client.

```bash
apt-get install -y ruby ruby-dev build-essential
gem install sensu sensu-plugin --no-ri --no-rdoc
```

Other plugins may require additional gems, such as the Redis and PostgreSQL metrics. They will need the `redis` and `pg` gems, respectively.

Now that we have the metric configured, restart the server and client. After I started receiving metrics, I went to Grafana and was able to configure a few panels. I could also see the checks flowing by on the Sensu logs.

![Grafana with some panels](/images/mep4/grafana.png)

### Common issues

If you don't see metrics flowing, go through this checklist.

1. WizardVan will buffer metrics until it can send them in a 16KB chunk. When you have only a handful of metrics, it may take awhile for the buffer to be filled. You can see this in `/var/log/sensu/sensu-server.log`.

2. There could be an error on the client. Look in `/var/log/sensu/sensu-client.log`.

3. If Carbon is incorrectly configured, the metrics may not be retained. Check the Carbon logs.

***

## Wrap-up

In this post, we installed Graphite, Grafana and Sensu. We also started collecting and storing metrics from multiple nodes. Historical metric data will be retained according to the Carbon retention policy. At this point you can start adding more metrics and sprucing up your dashboards on Grafana. In the next post I'll cover some Grafana tricks and starting with Sensu service checks.
