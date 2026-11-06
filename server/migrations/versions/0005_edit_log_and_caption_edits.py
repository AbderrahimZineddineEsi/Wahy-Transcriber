"""the edit log, caption edits and deleted findings

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-06 21:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'edit_ops',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecture_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('params', sa.JSON(), nullable=False),
        sa.Column('undo', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('undone_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lecture_id'], ['lectures.id'], name=op.f('fk_edit_ops_lecture_id_lectures'),
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_edit_ops')),
    )
    with op.batch_alter_table('edit_ops', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_edit_ops_lecture_id'), ['lecture_id'], unique=False)
    op.create_table(
        'caption_edits',
        sa.Column('lecture_id', sa.Integer(), nullable=False),
        sa.Column('edits', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['lecture_id'], ['lectures.id'], name=op.f('fk_caption_edits_lecture_id_lectures'),
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('lecture_id', name=op.f('pk_caption_edits')),
    )
    with op.batch_alter_table('findings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('deleted', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('findings', schema=None) as batch_op:
        batch_op.drop_column('deleted')
    op.drop_table('caption_edits')
    with op.batch_alter_table('edit_ops', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_edit_ops_lecture_id'))
    op.drop_table('edit_ops')
