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
      // The switcher works at Edition level (a specific year's instance,
      // e.g. "MIFB27") — Categories ride along under whichever Edition is
      // selected. listEvents already excludes the MAIN tier entirely (it's
      // a brand/grouping, not something you "work in"), so this can't rely
      // on !parent_event_id any more — an Edition under a Main now HAS a
      // parent_event_id (the Main's, which isn't even in this list).
      const editions = events.filter((ev) => ev.tier === 'EDITION');
      if (editions.length > 0) setSelectedEventId(editions[0].id);
      else if (events.length > 0) setSelectedEventId(events[0].id);
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
