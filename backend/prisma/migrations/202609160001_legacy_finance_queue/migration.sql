-- Existing orders that were waiting for the old one-step manager approval
-- now enter the finance queue so every active order follows the new workflow.
UPDATE orders
SET status='PENDING_FINANCE', updated_at=now(), version=version+1
WHERE status='PENDING_MANAGER' AND finance_recommendation IS NULL;
