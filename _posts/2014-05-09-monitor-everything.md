---
layout: post
title: "Monitoring Everything (Part 1)"
date: 2015-05-09 01:00:00
comments: true
---

Lately I've been taking an extensive look into modern monitoring stacks. This is a collection of notes I've taken about installing components as well as getting useful data out of them.

I'm going to be looking into:

- [Logstash](http://logstash.net/)
- [Sensu](http://sensuapp.org/)
- [Graphite](http://graphite.readthedocs.org/en/latest/)
- [Kale](http://codeascraft.com/2013/06/11/introducing-kale/)

In addition, we'll look at the interfaces for each components:

- [Kibana](http://www.elasticsearch.org/overview/kibana/)
- [Grafana](http://grafana.org/)
- [Sensu dashboard](https://github.com/sensu/sensu-dashboard)

The overall architecture is presented below. The circled section is what will be covered in this post.

![Architecture](http://i.imgur.com/aTX3twN.png)

All the included instructions are for Ubuntu Server 14.04, but they probably work on older releases too.

## Pre-installation

We'll go ahead and setup repositories before we do anything else

```sh
curl -s http://packages.elasticsearch.org/GPG-KEY-elasticsearch | apt-key add -

echo "deb http://packages.elasticsearch.org/logstash/1.4/debian stable main" > /etc/apt/sources.list.d/logstash.list
echo "deb http://packages.elasticsearch.org/elasticsearch/1.0/debian stable main" > /etc/apt/sources.list.d/elasticsearch.list

apt-get update
```

## Logstash

### Installation

```sh
apt-get install -y logstash logstash-contrib
update-rc.d logstash defaults
```

Simple right? Well, until we actually specify some configuration, Logstash will not start. We'll cover that later.

### Sensitive log access

If you want to use local log files as an input to Logstash, you may need to give it additional rights to read sensitive logs. You can do this one of two ways:

1. Add the `logstash` user to the same group as `syslog`

    ```sh
    usermod -a -G adm logstash
    ```

2. Set an ACL entry on the relevant logs, like so:

    ```sh
    # Single log
    setfacl -m u:logstash:r /var/log/redis/redis-server.log

    # Directory of logs
    setfacl -R -m u:logstash:r /var/log/upstart

    # Remove ACL entry
    setfacl -x u:logstash /var/log/syslog

    # View ACL entries
    getfacl /var/log/syslog
    ```

Using the ACL method is arguably more secure, since the permissions are much more fine-grained.

<div class="alert alert-warning">
  Don't just blindly set ACL entries on all logs, some processes (like OpenSSH) will complain about it.
</div>

## Elasticsearch

### Installation

I'm not going to spend too much time on Elasticsearch. The default configuration provided with Elasticsearch is reasonable enough for smaller environments.

```sh
apt-get install -y elasticsearch
```

### Curator

At some point, you'll need to start pruning old logs from Elasticsearch. They've created a simple tool called [Curator](https://github.com/elasticsearch/curator) that you can install and run as a cron job or manually.

```sh
apt-get install -y python-pip
pip install elasticsearch-curator
```

Now you can run stuff like

```sh
curator -d 30 -T days
curator -d 12 -T hours
```

### Head

For more manual maintenance of Elasticsearch, there is a third-party plugin that makes it super easy called [elasticsearch-head](https://github.com/mobz/elasticsearch-head).

```sh
cd /usr/share/elasticsearch && bin/plugin -install mobz/elasticsearch-head
```

Now just open `http://localhost:9200/_plugin/head` in your browser and play around. You can use this if you get too much garbage in Elasticsearch while trying out Logstash.

## Kibana

### Installation

The Logstash distribution we used also includes Kibana, but it's slightly outdated. Installing Kibana is easy enough that we'll just do it manually.

```sh
curl -O -L https://download.elasticsearch.org/kibana/kibana/kibana-3.0.1.tar.gz
tar xf kibana-3.0.1.tar.gz
cp -R kibana-3.0.1 /usr/share/kibana
```

Now we'll serve it up with Apache

```sh
apt-get install -y apache2
echo "alias /kibana /usr/share/kibana" > /etc/apache2/sites-enabled/kibana.conf
service apache2 reload
```

Open your browser to `http://localhost/kibana` and you should see the dashboard.

## Wrap-up

We've plugged in everything, but no data is flowing yet. The next post will start getting into inputs, filters and outputs. Once log entries make it to Elasticsearch, we'll start seeing how helpful Kibana can be.
