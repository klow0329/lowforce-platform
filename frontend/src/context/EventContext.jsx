import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

// A company can run multiple events concurrently — this holds which one the
// user is currently working in, shared across Opportunities (and later
// Sales Orders, Invoices, etc., which are all event-scoped the same way).
const EventContext = createContext(null);

export function EventProvider({ children }) {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listEvents().then(({ events }) => {
      setEvents(events);
      if (events.length > 0) setSelectedEventId(events[0].id);
      setLoading(false);
    });
  }, []);

  return (
    <EventContext.Provider value={{ events, selectedEventId, setSelectedEventId, loading }}>
      {children}
    </EventContext.Provider>
  );
}

export function useEventContext() {
  return useContext(EventContext);
}
