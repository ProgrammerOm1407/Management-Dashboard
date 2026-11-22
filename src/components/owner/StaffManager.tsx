import React, { useState } from 'react';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { Shop, StaffInvite } from '../../types';
import { inviteServerToShop, removeStaffInvite } from '../../lib/firestoreService';
import { useToast } from '../../context/ToastContext';

interface StaffManagerProps {
  shop: Shop;
  staff: StaffInvite[];
  loading: boolean;
}

export const StaffManager: React.FC<StaffManagerProps> = ({ shop, staff, loading }) => {
  const { pushToast } = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const normalized = email.trim().toLowerCase();
    if (staff.some((s) => s.email.toLowerCase() === normalized)) {
      setErrorMsg('That email is already assigned to this shop.');
      return;
    }

    setSubmitting(true);
    try {
      await inviteServerToShop(shop, fullName, normalized);
      pushToast(
        'Server account provisioned',
        `${fullName.trim()} can now sign in at /login to access /server.`,
        'success'
      );
      setFullName('');
      setEmail('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to add staff member.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (invite: StaffInvite) => {
    try {
      await removeStaffInvite(invite.id);
      pushToast('Staff removed', `${invite.full_name} removed from ${shop.name}.`, 'info');
    } catch (err) {
      pushToast('Removal failed', err instanceof Error ? err.message : 'Try again.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-900">Staff Management</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Add floor and kitchen Server accounts linked exclusively to{' '}
          <span className="font-mono text-slate-700">{shop.name}</span>.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Invite Server Form */}
        <form
          onSubmit={(e) => void handleInvite(e)}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-4 h-4 text-slate-600" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Add Server Account
            </h3>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Servers receive access to the real-time <span className="font-mono">/server</span>{' '}
            order board and read-only menu. Rooms, analytics, and settings remain owner-only.
          </p>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              maxLength={100}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Google Email Address
            </label>
            <input
              type="email"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="server@business.com"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 transition-opacity cursor-pointer"
            style={{ backgroundColor: shop.primary_color || '#0F172A' }}
          >
            {submitting ? 'Adding Server...' : 'Add Server to Shop'}
          </button>
        </form>

        {/* Team Roster Table */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">Shop Roster</h3>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {staff.length} {staff.length === 1 ? 'member' : 'members'}
            </span>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((n) => (
                <div key={n} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : staff.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-900">No staff invitations recorded yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Add your first server using the form to link their Google account to this shop.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-6">Member</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {staff.map((member) => (
                    <tr key={member.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-6">
                        <p className="font-medium text-slate-900">{member.full_name}</p>
                        <p className="text-xs font-mono text-slate-500">{member.email}</p>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700 capitalize whitespace-nowrap">
                        {member.role}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            member.status === 'active' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {member.status === 'active' ? 'Active' : 'Invited (Pending Login)'}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right whitespace-nowrap">
                        {member.role === 'server' ? (
                          <button
                            type="button"
                            onClick={() => void handleRemove(member)}
                            aria-label={`Remove ${member.full_name}`}
                            className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Primary Owner</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
