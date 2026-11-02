"""Baseline: users and their sessions, and Walk-in Founders' campaigns, pledges, payouts and PayPal's webhook events.

Revision ID: 0001
Revises:
Create Date: 2026-11-02

A campaign keeps what its page shows (the business, the place, why here). Deleting its owner's account leaves the
campaign without an owner. A pledge keeps only the SHA-256 of its private receipt, never the receipt.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def timestamp(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("picture", sa.String(1024), nullable=True),
        timestamp("created_at"),
        timestamp("updated_at"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("subject", name=op.f("uq_users_subject")),
    )

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        timestamp("created_at"),
        timestamp("expires_at"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("token_hash", name=op.f("pk_sessions")),
    )
    for column in ("user_id", "expires_at"):
        op.create_index(op.f(f"ix_sessions_{column}"), "sessions", [column])

    op.create_table(
        "campaigns",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("offer", sa.JSON(), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("goal_count", sa.Integer(), nullable=False),
        timestamp("deadline"),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("payout_email", sa.String(320), nullable=False),
        timestamp("closed_at", nullable=True),
        sa.Column("funded", sa.Boolean(), nullable=True),
        sa.Column("report", sa.JSON(), nullable=True),
        timestamp("created_at"),
        timestamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_campaigns_user_id_users"), ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_campaigns")),
    )
    for column in ("user_id", "status"):
        op.create_index(op.f(f"ix_campaigns_{column}"), "campaigns", [column])

    op.create_table(
        "pledges",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("order_id", sa.String(64), nullable=False),
        sa.Column("flow", sa.String(16), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("payer_id", sa.String(64), nullable=True),
        sa.Column("authorization_id", sa.String(64), nullable=True),
        timestamp("authorized_at", nullable=True),
        timestamp("expires_at", nullable=True),
        sa.Column("reauthorization_id", sa.String(64), nullable=True),
        timestamp("reauthorized_at", nullable=True),
        sa.Column("capture_id", sa.String(64), nullable=True),
        sa.Column("capture_status", sa.String(32), nullable=True),
        sa.Column("net_cents", sa.Integer(), nullable=True),
        timestamp("captured_at", nullable=True),
        sa.Column("error", sa.String(64), nullable=True),
        sa.Column("receipt_hash", sa.String(64), nullable=True),
        timestamp("created_at"),
        timestamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["campaign_id"], ["campaigns.id"], name=op.f("fk_pledges_campaign_id_campaigns"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pledges")),
        sa.UniqueConstraint("order_id", name=op.f("uq_pledges_order_id")),
    )
    for column in ("campaign_id", "status", "authorization_id", "reauthorization_id", "capture_id"):
        op.create_index(op.f(f"ix_pledges_{column}"), "pledges", [column])
    op.create_index(op.f("ix_pledges_receipt_hash"), "pledges", ["receipt_hash"], unique=True)

    op.create_table(
        "payouts",
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("batch_id", sa.String(64), nullable=True),
        sa.Column("item_id", sa.String(64), nullable=True),
        sa.Column("paypal_status", sa.String(16), nullable=True),
        sa.Column("error", sa.String(200), nullable=True),
        timestamp("created_at"),
        timestamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["campaign_id"], ["campaigns.id"], name=op.f("fk_payouts_campaign_id_campaigns"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("campaign_id", name=op.f("pk_payouts")),
    )
    for column in ("status", "batch_id"):
        op.create_index(op.f(f"ix_payouts_{column}"), "payouts", [column])

    op.create_table(
        "paypal_events",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(64), nullable=True),
        timestamp("received_at"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_paypal_events")),
    )


def downgrade() -> None:
    for table in ("paypal_events", "payouts", "pledges", "campaigns", "sessions", "users"):
        op.drop_table(table)
