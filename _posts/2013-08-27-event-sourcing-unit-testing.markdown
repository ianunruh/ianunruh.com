---
layout: post
title: "Event Sourcing &amp; Unit Testing"
date: 2013-08-27 22:29:00
categories: ruby
---
When using event sourcing with techniques from domain-driven design, one of the great benefits you get is ease of unit testing. Since Ruby revolves around TDD, this small benefit goes pretty far.

Using the example presented in my previous post about event sourcing, I wrote a simple spec for testing:

{% highlight ruby %}
describe InventoryItem do
  it 'allows quantity changes after being reactivated' do
    history = [
      ItemCreated.new(id, name),
      ItemDeactivated.new(id),
      ItemReactivated.new(id)
    ]

    item = InventoryItem.from_history history
    item.check_in 100

    item.changes.should == [
      ItemsCheckedIn.new(id, 100)
    ]
  end
end
{% endhighlight %}

This pattern is repeated in any tests involved an event-source aggregate.

When testing if operations properly implement business logic, you can ensure that no side-effects have occurred to your aggregate. This is demonstrated in the next example.

{% highlight ruby %}
describe InventoryItem do
  it 'does not allow quantity changes when deactivated' do
    history = [
      ItemCreated.new(id, name),
      ItemDeactivated.new(id)
    ]

    item = InventoryItem.from_history history

    expect {
      item.check_in 100
    }.to raise_error DomainError

    item.changes.should == []
  end
end
{% endhighlight %}

When testing idempotent operations, you can also ensure no side-effects occur.

{% highlight ruby %}
describe InventoryItem do
  it 'supports idempotent deactivation' do
    history = [
      ItemCreated.new(id, name),
      ItemDeactivated.new(id)
    ]

    item = InventoryItem.from_history history
    item.deactivate

    item.changes.should == []
  end
end
{% endhighlight %}

You can also test the creation of a new aggregate using the standard constructor, as well as the changes in aggregate state (if you wish to expose those attributes), and the changes in aggregate version.

The full, working spec is available on [GitHub](https://github.com/ianunruh/simple_es).
