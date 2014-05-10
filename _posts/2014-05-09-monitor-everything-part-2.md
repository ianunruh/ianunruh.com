---
layout: post
title: "Monitoring Everything (Part 2)"
date: 2015-05-09 01:00:00
comments: true
---

In the [previous post](/2015/05/monitor-everything.html), we installed Logstash and friends, but they aren't doing anything at the moment. This post will go over the configuration of the Logstash indexer, as well as shipping logs from other machines to the indexer.

![Diagram](http://i.imgur.com/Q0JPgNJ.png)

## Local Logstash indexing

### Basic syslog input

The first configuration we'll apply to Logstash is a local syslog file input. It should read and normalize entries from:

- `/var/log/syslog`
- `/var/log/auth.log`

Create `/etc/logstash/conf.d/15-input-file.conf` with the contents:

```
input {
  file {
    type => "syslog"
    path => ["/var/log/auth.log", "/var/log/syslog"]
  }
}

filter {
  if [type] == "syslog" {
    grok {
      match => {
        "message" => ["%{SYSLOGPAMSESSION}", "%{CRONLOG}", "%{SYSLOGLINE}"]
      }
      overwrite => "message"
    }

    date {
      match => ["timestamp", "MMM  d HH:mm:ss", "MMM dd HH:mm:ss"]
      remove_field => ["timestamp"]
    }

    date {
      match => ["timestamp8601", "ISO8601"]
      remove_field => ["timestamp8601"]
    }
  }
}
```

Some observations about this configuration file:

- I've tried to use canonical syntax and options where ever possible
- I'm reusing [patterns that are distributed with Logstash](https://github.com/elasticsearch/logstash/tree/v1.4.1/patterns)
- The `grok` filter will short circuit upon the first matching pattern (meaning that order is important). It also extracts certain fields from log entries, such as `timestamp` and `program`.
- Depending on the timestamp format used in the log entry, the pattern will spit out either `timestamp` or `timestamp8601`
- The `date` filter causes Logstash to use the timestamp of the entry itself, rather than recording when Logstash recorded the entry (very important when dealing with historical log entries)

Now that we're reading and filtering these logs, the results have to go somewhere. For now, we'll just test with stdout. Create `/etc/logstash/conf.d/90-output-stdout.conf` with the contents:

```
output {
  stdout {
    codec => rubydebug
  }
}
```

To test it all out, run the following:

```sh
sudo -u logstash /opt/logstash/bin/logstash agent -f /etc/logstash/conf.d
```

At first, nothing may appear. This is because Logstash will stream from the end of files by default. You can trigger some logs immediately by logging in or out of the monitoring box in another terminal. If you wish to test your filters against historical entries, you can also modify the `input` section of `15-input-file.conf` to be the following:

```
input {
  file {
    type => "syslog"
    path => ["/var/log/auth.log", "/var/log/syslog"]
    start_positon => beginning
    sincedb_path => "/dev/null"
  }
}
```

This change will cause Logstash to start at the beginning of all files *every time it runs*. Obviously you don't want this in normal environments, but it sure makes debugging your filters easier.

Once you know your filters work as expected, remove our debugging options from `15-input-file.conf`. Then, create `/etc/logstash/conf.d/90-output-elasticsearch.conf` with the contents:

```
output {
  elasticsearch {
    codec => rubydebug
  }
}
```

Optionally, you can remove `90-output-stdout.conf` so that the logs for Logstash itself won't be filled with garbage. Now that we have a working configuration, it's possible to start the Logstash service.

```sh
service logstash start
```

If you browse to `http://localhost/kibana`, you should start seeing logs flowing in.

### Common issues

If Logstash does not start, look in the following logs for any errors:

- `/var/log/upstart/logstash.log`
- `/var/log/logstash/logstash.log`

If permission is denied to log files, refer to the previous post for instructions on granting additional permissions to Logstash.

To check if the configuration is valid without starting Logstash, run the following:

```sh
sudo -u logstash /opt/logstash/bin/logstash agent -f /etc/logstash/conf.d --configtest
```

## Shipping to Logstash

Obviously, Logstash isn't terribly useful if you're only using it on a single machine. To start shipping logs from your boxes, there are a wide range of agents you can use. Just off the top of my head, you can use:

- Logstash itself
- Syslog and friends (rsyslog, syslog-ng)
- [logstash-forwarder](https://github.com/elasticsearch/logstash-forwarder)
- All the shippers listed on the [Logstash cookbook](http://cookbook.logstash.net/recipes/log-shippers/)

The issue with using Logstash as the shipper is its memory footprint. Logstash runs on the JVM and requires a minimum of 100MB memory. This becomes an issue when you're running on micro-sized instances on your cloud provider. Instead, I've chosen `logstash-forwarder` since it seems to be the official alternative to running Logstash itself.

### Indexer prep

Before setting up `logstash-forwarder`, we need to generate an SSL certificate to share between the indexer and the shippers. We can easily do this with OpenSSL:

```sh
openssl req -x509 -batch -nodes -newkey rsa:2048 -keyout logstash-forwarder.key -out logstash-forwarder.crt

chown logstash:logstash logstash-forwarder.{crt,key}
chmod 600 logstash-forwarder.{crt,key}

mv logstash-forwarder.crt /etc/ssl/certs
mv logstash-forwarder.key /etc/ssl/private
```

That wasn't so bad, was it? Now, create `/etc/logstash/conf.d/10-input-lumberjack.conf` with the following:

```
input {
  lumberjack {
    port => 5000
    ssl_key => "/etc/ssl/private/logstash-forwarder.key"
    ssl_certificate => "/etc/ssl/certs/logstash-forwarder.crt"
  }
}
```

Restart the indexer with `service logstash restart`. You should see it listening with `netstat -ltupn`.

### Installation

On your indexer node, download and build `logstash-forwarder`.

```sh
apt-get install -y golang git

git clone git://github.com/elasticsearch/logstash-forwarder.git
cd logstash-forwarder

make
```

Next, create a Debian package to distribute to the nodes you want to ship logs from. This requires you to have Ruby installed on your indexer node.

```sh
gem install fpm --no-rdoc --no-ri
make deb
```

You can now reuse this package for any nodes you want to ship from. Secure copy the SSL certificate/key and package to the target node.

```sh
scp \
  logstash-forwarder*.deb \
  /etc/ssl/certs/logstash-forwarder.crt \
  /etc/ssl/private/logstash-forwarder.key \
  username@target-node:~/
```

On the target node, login and run the following:

```sh
chown root:root logstash-forwarder.{crt,key}
chmod 600 logstash-forwarder.{crt,key}

mv logstash-forwarder.crt /etc/ssl/certs
mv logstash-forwarder.key /etc/ssl/private

dpkg -i logstash-forwarder*.deb
```

Create `/etc/logstash-forwarder` with the contents:

```json
{
  "network": {
    "servers": ["indexer:5000"],
    "ssl ca": "/etc/ssl/certs/logstash-forwarder.crt",
    "ssl certificate": "/etc/ssl/certs/logstash-forwarder.crt",
    "ssl key": "/etc/ssl/private/logstash-forwarder.key"
  },
  "files": [
    {
      "paths": ["/var/log/syslog"],
      "fields": {
        "type": "syslog"
      }
    }
  ]
}
```

Now start `logstash-forwarder` with `service logstash-forwarder start`.

On the indexer, the raw logs are received over the Lumberjack protocol. They are then processed by the same filters we use when normalizing local syslog files. This is because we set the `type` to `syslog` in the `logstash-forwarder` configuration.

## Wrap-up

In this post, we got actual logs feeding into Logstash. They are now queryable in Kibana, so explore away!
