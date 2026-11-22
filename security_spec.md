# Security Specification — HostGrid Multi-Tenant SaaS

## 1. Core Data Invariants
1. **Strict Multi-Tenant Isolation (`shop_id`)**: Every operational record (`menu_items`, `orders`, `rooms`, `room_bookings`) lives under `/shops/{shopId}/...` AND stores `shop_id == shopId` (immutable). Users bound to `shopA` cannot read private records or mutate any records in `shopB`.
2. **No Privilege Escalation on Profiles**: Users cannot self-assign `super_admin`, `owner`, or `server` roles during profile creation or update. Only the verified bootstrapped Super Admin email (`programmerom2006@gmail.com`) can claim `super_admin`; all `owner` and `server` profiles must match an existing `staff_invites` record matching their verified email, role, and `shop_id`.
3. **Module RBAC Enforcement**:
   - **Menu**: Owners (and Super Admin) can add/edit/delete; Servers can only read.
   - **Orders**: Servers can create orders and advance status (`pending` -> `preparing` -> `ready` -> `served`, terminal locked at `served` except Super Admin); Owners can view all orders and manage staff; Guests on `/s/[slug]` can create `pending` orders when shop is active and `modules.orders == true`.
   - **Rooms & Bookings**: Strictly Owner (and Super Admin) write access when `modules.rooms == true`; `room_bookings` PII is unreadable by Servers and Guests.
4. **PII Isolation**: `/shop_slugs/{slug}` exposes only public branding/module metadata with zero emails or guest contacts. `/shops/{shopId}`, `/profiles/{uid}`, `/staff_invites/{inviteId}`, `/shops/{shopId}/orders/{orderId}`, and `/shops/{shopId}/room_bookings/{bookingId}` enforce authenticated role checks.

## 2. The Dirty Dozen Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Assigned Super Admin**: Non-admin user creating `/profiles/{uid}` with `{ "role": "super_admin", "shop_id": null }`.
2. **Role Escalation Update**: Server updating their own `/profiles/{uid}` to `{ "role": "owner" }`.
3. **Cross-Tenant Menu Write**: Owner of `shop-a` attempting to create `/shops/shop-b/menu_items/item1`.
4. **Server Menu Mutation**: Server of `shop-a` attempting to create/edit/delete `/shops/shop-a/menu_items/item1`.
5. **Server Room/Booking Mutation**: Server of `shop-a` attempting to create `/shops/shop-a/rooms/r1` or read `/shops/shop-a/room_bookings/b1`.
6. **Shadow Field Injection**: Owner updating `/shops/shop-a` with extra key `{ "is_active": true, "modules": { "menu": true, "orders": true, "rooms": true } }`.
7. **Unverified Admin Spoof**: Request with `email == 'programmerom2006@gmail.com'` and `email_verified == false`.
8. **Order Terminal State Tampering**: Server updating an order whose `existing().status == 'served'` back to `'pending'`.
9. **Order Total Manipulation on Status Update**: Server updating `/shops/shop-a/orders/ord1` with `{ "status": "ready", "total_amount": 0 }`.
10. **Guest Order on Suspended Shop**: Unauthenticated guest creating an order under a shop where `is_active == false` or `modules.orders == false`.
11. **Oversized ID / Resource Poisoning**: Creating a document with a 200-character ID or invalid characters (`../evil`).
12. **PII Blanket Read**: Authenticated non-owner reading another user's `/profiles/{otherUid}` or `/shops/shop-a/room_bookings/b1`.
