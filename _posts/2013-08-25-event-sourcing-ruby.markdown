---
layout: post
title: "Event Sourcing in Ruby"
date: 2013-08-25 17:37:00
comments: true
---

An excellent starting place for event sourcing is described at the [Event Sourcing Basics](https://github.com/eventstore/eventstore/wiki/Event-Sourcing-Basics) page on the EventStore wiki. What I'd like to do is start at the beginning and try to figure out a simple model for event sourcing in Ruby.

### Aggregate Modeling

For an example, I'll model an inventory item using event sourcing. Efficient inventory management might be a competitive advantage for a business and could be considered a collaborative domain, making it a good candidate for event sourcing. Since the physical items in the warehouse are the single source of truth, our application acts as a downstream event processor. Delays in reporting of inventory changes from the warehouse forces us to accept that our model is eventually consistent. Therefore, the only business rules for an inventory item are as follows:

* If the quantity of an item is not zero, it cannot be deactivated
* If an inventory item has been deactivated, no items can be checked in or removed from inventory

We allow the quantity to underflow, in the case that a removal of inventory is reported before a check-in of inventory.

The API for our aggregate is as follows:

```ruby
class InventoryItem
  def initialize(id, name)
  end

  def deactivate
  end

  def check_in(quantity)
  end

  def remove(quantity)
  end
end
```

The possible events are:

```ruby
ItemCreated = Struct.new :id, :name
ItemsCheckedIn = Struct.new :id, :quantity
ItemsRemoved = Struct.new :id, :quantity
ItemDeactivated = Struct.new :id
```

The events are modeled using plain-old Ruby objects (POROs). Each event must capture enough information to be able to rebuild the aggregate to its current state.

### Aggregate root

Different scenarios are possible for describing how an aggregate is brought into a usable state:

* The aggregate is created for the first time using its constructor
* An existing aggregate is restored from an event stream

When snapshotting is involved, other scenarios are possible. For now, however, I'll just focus on the two I mentioned.

```ruby
class AggregateRoot
  attr_reader :id

  # Bypasses the constructor
  def self.from_history(events)
    allocate.tap { |a|
      a.initialize_from_history events
    }
  end

  # Returns a copy of the list of changes made to this aggregate
  def changes
    if @changes
      @changes.dup
    else
      []
    end
  end

  def version
    @version || 0
  end

  def initialize_from_history(events)
    events.each do |event|
      transition_to event
    end
  end

  protected

  def apply(event)
    transition_to event

    @changes ||= []
    @changes.push event
  end

  def handle(event)
    raise NotImplementedError
  end

  private

  def transition_to(event)
    handle event
    @version = version.next
  end
end
```

When the aggregate is first instantiated, it starts at version 0. Each additional event causes the version to increment. If the aggregate is being restored from an event stream, events from the stream are not added to the changes list.

To enable the constructor to be used for domain purposes, we use lazy initialization on the `changes` and `version` fields. To finish implementing this base class, we also need to be able to clear the changes once the aggregate is committed, and be able to do some additional introspection on the aggregate:

```ruby
class AggregateRoot
  def clear_changes
    @changes.clear if @changes
  end

  def dirty?
    @changes && @changes.size > 0
  end

  def initial_version
    version - changes.size
  end
end
```

# Inventory item aggregate

Now, to implement the aggregate for an inventory item, it looks something like this:

```ruby
class InventoryItem < AggregateRoot
  def initialize(id, name)
    apply(ItemCreated.new(id, name))
  end

  def deactivate
    unless @quantity == 0
      raise DomainError, "Quantity is greater than zero"
    end

    apply(ItemDeactivated.new(id))
  end

  def check_in(quantity)
    unless @active
      raise DomainError, "Item has been deactivated"
    end

    apply(ItemsCheckedIn.new(id, quantity))
  end

  def remove(quantity)
    apply(ItemsRemoved.new(id, quantity))
  end

  protected

  def handle(event)
    case event
    when ItemCreated
      @id = event.id
      @name = event.name
      @quantity = 0
      @active = true
    when ItemsCheckedIn
      @quantity = @quantity + event.quantity
    when ItemsRemoved
      @quantity = @quantity - event.quantity
    when ItemDeactivated
      @active = false
    else
      raise ArgumentError, "Unknown event #{event.class}"
    end
  end
end
```

This implementation completely encapsulates the state of the aggregate, only exposing it in the form of domain events. The case statement that is used to mutate the state of the aggregate could be refactored into convention-based or registration-based routing for better looking code. Also notice that the public methods don't actually mutate the state of the aggregate. The state is mutated based solely on the events applied to the aggregate. The separation of duties forces the developer to model events correctly.

Interacting with the aggregate would happen like so:

```ruby
item = InventoryItem.new '4b102909-401f-4605-8e67-edb0b8def603', 'Awesomesauce'
item.check_in 100

item.initial_version # => 0
item.version # => 2
```

Now, I can get a list of events that have been applied to the aggregate and use it to rebuild the aggregate from scratch:

```ruby
events = item.changes

loaded = InventoryItem.from_history events
loaded.remove 10

item.initial_version # => 2
item.version # => 3
```

After operations have been performed on the aggregate (usually in the scope of a command, when referring to CQRS), the changes applied to the aggregate are appended to the event store for the aggregate. Afterwards, they are published to an event bus. Listeners for these events could be used to build various read models, trigger alerts on low inventory, etc.

Ruby does not have a service bus on the scale of NServiceBus or Spring Integration, but one could be started.

A full example of event sourcing in Ruby is available on [GitHub](https://github.com/ianunruh/simple_es).

### Future

Now that we have a basic model for an aggregate, the next step is persistence. The actual storage mechanism isn't that important for event sourcing, document databases (MongoDB) or relational databases could be used. One thing to note is that relational databases support transactions, so a batch of events could be atomically appended to the store. The alternative is to use [EventStore](http://geteventstore.com). I'm interested in writing a Ruby client API for Event Store, since there doesn't seem to be one yet.
