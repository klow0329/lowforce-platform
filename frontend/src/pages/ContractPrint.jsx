import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function ContractPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [salesOrder, setSalesOrder] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getSalesOrder(id), api.getCompany()]).then(([so, c]) => {
      setSalesOrder(so.salesOrder);
      setCompany(c.company);
    });
  }, [id]);

  if (!salesOrder || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const isCoex = salesOrder.contract_type === 'COEX';
  const docTitle = isCoex ? 'CO-EXHIBITOR CONTRACT' : 'EXHIBITION SPACE CONTRACT';

  const same = salesOrder.billing_same_as_company;
  const billTo = {
    name: same ? salesOrder.company_name : (salesOrder.billing_name || salesOrder.company_name),
    address: salesOrder.billing_address || '—',
    postcodeCity: [same ? salesOrder.postcode : salesOrder.billing_postcode, same ? salesOrder.city : salesOrder.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? salesOrder.country_code : salesOrder.billing_country_code) || '—',
    regNo: same ? salesOrder.reg_no : salesOrder.billing_reg_no,
    tinNo: same ? salesOrder.tin_no : salesOrder.billing_tin_no,
    sstNo: same ? salesOrder.sst_no : salesOrder.billing_sst_no,
    contactNo: same ? salesOrder.contact1_phone : salesOrder.billing_contact_no,
    email: (same ? salesOrder.contact1_email : salesOrder.billing_email) || '—',
  };

  return (
    <div style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/sales-orders/${id}`)}>Back</button>
        <button type="button" onClick={() => window.print()}>Print</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
        <div style={{ fontSize: 14, color: '#5c6070' }}>{salesOrder.event_name}</div>
        <h2 style={{ marginTop: 16, marginBottom: 0 }}>{docTitle}</h2>
        {isCoex && (
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            This exhibitor participates under the sponsorship of the main exhibitor booth holder.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <h4>Exhibitor</h4>
          <div>{salesOrder.company_name}</div>
          <div>{salesOrder.country_code || '—'}</div>
          <div>{salesOrder.contact1_name || '—'}</div>
          <div>{salesOrder.contact1_email || '—'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <h4>Bill To</h4>
          <div>{billTo.name}</div>
          <div>{billTo.address}</div>
          {billTo.postcodeCity && <div>{billTo.postcodeCity}</div>}
          <div>{billTo.country}</div>
          {billTo.regNo && <div>Co. Reg No: {billTo.regNo}</div>}
          {billTo.tinNo && <div>TIN No: {billTo.tinNo}</div>}
          {billTo.sstNo && <div>SST No: {billTo.sstNo}</div>}
          {billTo.contactNo && <div>Contact: {billTo.contactNo}</div>}
          <div>{billTo.email}</div>
        </div>
      </div>

      <h4>Contract Details</h4>
      <div style={line}><span>Contract Type</span><span>{isCoex ? 'Co-Exhibitor (CoEX)' : 'Standard'}</span></div>
      <div style={line}><span>Contract Date</span><span>{salesOrder.contract_date || '—'}</span></div>
      <div style={line}><span>Booking Type</span><span>{salesOrder.booking_type || '—'}</span></div>
      <div style={line}><span>Hall / Booth No</span><span>{[salesOrder.hall, salesOrder.booth_no].filter(Boolean).join(' / ') || '—'}</span></div>
      <div style={line}><span>Booth Type</span><span>{salesOrder.booth_type || '—'}</span></div>
      <div style={line}><span>Dimension</span><span>{salesOrder.dimension || '—'}</span></div>
      <div style={line}><span>Booth Area</span><span>{salesOrder.booth_sqm ? `${salesOrder.booth_sqm} sqm` : '—'}</span></div>
      <div style={line}><span>Salesperson</span><span>{salesOrder.salesperson_name || '—'}</span></div>
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Total Contract Value</span><span>{fmtMYR(salesOrder.total_myr)}</span>
      </div>

      <div style={{ display: 'flex', gap: 32, marginTop: 64 }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>For and on behalf of {company.name}</div>
          <div style={{ marginTop: 32, borderTop: '1px solid #333', paddingTop: 4 }}>Date</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>For and on behalf of {salesOrder.company_name}</div>
          <div style={{ marginTop: 32, borderTop: '1px solid #333', paddingTop: 4 }}>Date</div>
        </div>
      </div>
    </div>
  );
}
