"""verdict details and the findings of each AI request

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-06 19:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('verdicts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('confidence', sa.Double(), nullable=True))
        batch_op.add_column(sa.Column('details', sa.JSON(), nullable=True))
    with op.batch_alter_table('ai_requests', schema=None) as batch_op:
        batch_op.add_column(sa.Column('finding_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('ai_requests', schema=None) as batch_op:
        batch_op.drop_column('finding_ids')
    with op.batch_alter_table('verdicts', schema=None) as batch_op:
        batch_op.drop_column('details')
        batch_op.drop_column('confidence')
