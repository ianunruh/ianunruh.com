---
layout: post
title: "Shipping and Indexing with Logstash"
date: 2014-05-11 02:00:00
comments: true
---

{% include monitoring-series.html %}

In the [previous post](/2014/05/monitor-everything.html), we installed Logstash and friends, but they aren't doing anything at the moment. This post will go over the configuration of the Logstash indexer as well as shipping logs from other nodes to the indexer.

<div class="clearfix"></div>

![Diagram](https://i.imgur.com/8iyv9g1.png)

## Local Logstash indexing

### Basic syslog input

The first configuration we'll apply to Logstash is a local syslog file input. It should read and normalize entries from the following files.

- `/var/log/syslog`
- `/var/log/auth.log`

First, give Logstash permission to read these files:

```bash
setfacl -m u:logstash:r /var/log/{syslog,auth.log}
```

Then create `/etc/logstash/conf.d/15-input-file.conf` with the contents:

```ruby
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

Now that we're reading and filtering these logs, the results have to go somewhere. For now we'll just test with stdout. Create `/etc/logstash/conf.d/90-output-stdout.conf` with the contents:

```ruby
output {
  stdout {
    codec => rubydebug
  }
}
```

To test it all out, run the following:

```bash
sudo -u logstash /opt/logstash/bin/logstash agent -f /etc/logstash/conf.d
```

Nothing may appear at first due to Logstash streaming from the end of files by default. You can trigger some logs immediately by logging in or out of the monitoring node in another terminal. If you wish to test your filters against historical entries, you can also modify the `input` section of `15-input-file.conf` to be the following:

```ruby
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

Once you know your filters work as expected, remove our debugging options from `15-input-file.conf`. Then create `/etc/logstash/conf.d/90-output-elasticsearch.conf` with the following contents.

```ruby
output {
  elasticsearch {
    host => "localhost"
    # Uncomment the following line if you're working with Elasticsearch 0.90.x
    # protocol => http
  }
}
```

Optionally you can remove `90-output-stdout.conf` so that the logs for Logstash itself won't be filled with garbage. Now that we have a working configuration, it's possible to start the Logstash service.

```bash
service logstash restart
```

If you browse to `http://localhost/kibana` you should start seeing logs flowing in.

### Common issues

If Logstash does not start, look in the following logs for any errors:

- `/var/log/upstart/logstash.log`
- `/var/log/logstash/logstash.log`

If permission is denied to log files, refer to the previous post for instructions on granting additional permissions to Logstash.

To check if the configuration is valid without starting Logstash, run the following:

```bash
sudo -u logstash /opt/logstash/bin/logstash agent -f /etc/logstash/conf.d --configtest
```

***

## Shipping to Logstash

Obviously Logstash isn't terribly useful if you're only using it on a single node. There are a wide range of agents you can use to ship logs from your nodes.

- Logstash itself
- Syslog and friends (rsyslog, syslog-ng)
- [logstash-forwarder](https://github.com/elasticsearch/logstash-forwarder)
- All the shippers listed on the [Logstash cookbook](http://cookbook.logstash.net/recipes/log-shippers/)

Logstash runs on the JVM; this causes its memory footprint to be 100MB at minimum. This may be prohibitive for smaller cloud instances. We'll look into slimmer shippers in a later post. For now, I'll just setup Logstash as our shipper. We'll use [Redis](http://redis.io/) as a broker between the shipper and the indexer.

### Redis

We'll just use the version of Redis supplied with the package manager.

```bash
apt-get install -y redis-server
```

We need Redis to listen on all ports, so change `/etc/redis/redis.conf` to the following.

```
daemonize yes
pidfile /var/run/redis/redis-server.pid
port 6379

loglevel notice
logfile /var/log/redis/redis-server.log

stop-writes-on-bgsave-error yes

rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb

dir /var/lib/redis
```

Restart Redis with `service redis-server restart`.

Create `/etc/logstash/conf.d/10-input-redis.conf` with the following.

```ruby
input {
  redis {
    host => "localhost"
    key => "logstash"
    data_type => "list"
    codec => json
  }
}
```

Now restart Logstash with `service logstash restart`.

### Shipper

Install Logstash on the node you want to ship logs from. This works just like on the indexer node.

```bash
curl -s http://packages.elasticsearch.org/GPG-KEY-elasticsearch | apt-key add -

echo "deb http://packages.elasticsearch.org/logstash/1.4/debian stable main" > /etc/apt/sources.list.d/logstash.list

apt-get update
apt-get install -y logstash
update-rc.d logstash defaults
```

We're going to read the same files we do on the indexer but we're going to ship them to the indexer. Again, give Logstash permission to read these logs.

```bash
apt-get install -y acl
setfacl -m u:logstash:r /var/log/{syslog,auth.log}
```

Create `/etc/logstash/conf.d/shipper.conf` with the following contents.

```ruby
input {
  file {
    type => "syslog"
    path => ["/var/log/auth.log", "/var/log/syslog"]
  }
}

filter {
  mutate {
    replace => ["host", "SHIPPER_HOSTNAME"]
  }
}

output {
  redis {
    host => "INDEXER_HOSTNAME"
    data_type => "list"
    key => "logstash"
    codec => json
  }
}
```

Start up Logstash with `service logstash start`

You should start seeing logs flowing on Kibana. Repeat the steps in this section for any additional nodes.

***

## Log file templates

I've created and tested several sets of inputs and filters for common applications. These are available in my [monitoring](https://github.com/ianunruh/monitoring/tree/master/etc/logstash/conf.d) repository on GitHub.

***

## Wrap-up

Now the indexer is being shipped logs from other nodes. This configuration will scale pretty decently; we just need to add more Redis instances for failover and load balancing purposes. Currently logs are shipped to Redis unencrypted. I'll cover some improvements we can make to this infrastructure in the [next post](/2014/05/monitor-everything-part-3.html).
