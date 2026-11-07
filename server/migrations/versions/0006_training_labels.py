"""training rows: a label's task and external key; a Tafrigh example has no verdict

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-07 02:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('task', sa.String(length=32), server_default='verification', nullable=False))
        batch_op.add_column(sa.Column('key', sa.String(), nullable=True))
        batch_op.alter_column('verdict', existing_type=sa.String(length=16), nullable=True)
        batch_op.create_index(batch_op.f('ix_labels_key'), ['key'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM labels WHERE verdict IS NULL")
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_labels_key'))
        batch_op.alter_column('verdict', existing_type=sa.String(length=16), nullable=False)
        batch_op.drop_column('key')
        batch_op.drop_column('task')
