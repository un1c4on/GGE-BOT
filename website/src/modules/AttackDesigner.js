import * as React from 'react'
import { 
    Box, Typography, Grid, Paper, Tab, Tabs, 
    Button, Avatar, Badge, Tooltip, IconButton, Divider,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DoubleArrowIcon from '@mui/icons-material/DoubleArrow'
import GavelIcon from '@mui/icons-material/Gavel' 
import ConstructionIcon from '@mui/icons-material/Construction'

export default function AttackDesigner({ inventory, onSave, onClose, t }) {
    const [currentWave, setCurrentWave] = React.useState(0);
    const [plan, setAttackPlan] = React.useState([
        { left: { units: [], tools: [] }, mid: { units: [], tools: [] }, right: { units: [], tools: [] } },
        { left: { units: [], tools: [] }, mid: { units: [], tools: [] }, right: { units: [], tools: [] } },
        { left: { units: [], tools: [] }, mid: { units: [], tools: [] }, right: { units: [], tools: [] } },
        { left: { units: [], tools: [] }, mid: { units: [], tools: [] }, right: { units: [], tools: [] } }
    ]);

    const [dropData, setDropData] = React.useState(null);
    const [quantity, setQuantity] = React.useState(50);

    const units = inventory?.filter(i => i.category === 'unit') || [];
    const tools = inventory?.filter(i => i.category === 'tool') || [];

    const handleDragStart = (e, item) => {
        e.dataTransfer.setData("item", JSON.stringify(item));
    };

    const handleDrop = (e, flank, type) => {
        e.preventDefault();
        try {
            const item = JSON.parse(e.dataTransfer.getData("item"));
            setDropData({ flank, type, item });
        } catch (err) { console.error("Drop error", err); }
    };

    const confirmAdd = () => {
        if (!dropData) return;
        const { flank, type, item } = dropData;
        const newPlan = [...plan];
        const slot = newPlan[currentWave][flank][type];
        
        const existing = slot.find(i => i.wodID === item.wodID);
        if (existing) {
            existing.count = Number(existing.count) + Number(quantity);
        } else if (slot.length < 10) {
            slot.push({ ...item, count: Number(quantity) });
        }
        
        setAttackPlan(newPlan);
        setDropData(null);
        setQuantity(50);
    };

    const Slot = ({ flank, type, label, color }) => (
        <Paper 
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, flank, type)}
            sx={{ 
                p: 2, minHeight: '120px', bgcolor: 'rgba(0,0,0,0.5)', 
                border: '2px dashed', borderColor: 'rgba(255,255,255,0.1)', borderRadius: 3,
                transition: 'all 0.2s', '&:hover': { borderColor: color, bgcolor: 'rgba(255,255,255,0.02)' }
            }}
        >
            <Typography variant="caption" sx={{ color: color, fontWeight: 'bold', mb: 1, display: 'block', letterSpacing: 1 }}>{label}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                {plan[currentWave][flank][type].map((item, i) => (
                    <Badge key={i} badgeContent={item.count} color="primary" overlap="circular">
                        <Tooltip title={item.name}>
                            <Avatar 
                                variant="rounded" 
                                sx={{ width: 45, height: 45, bgcolor: '#1e1e1e', cursor: 'pointer', border: '1px solid #444' }}
                                onClick={() => {
                                    const np = [...plan];
                                    np[currentWave][flank][type].splice(i, 1);
                                    setAttackPlan(np);
                                }}
                            >
                                {item.name[0]}
                            </Avatar>
                        </Tooltip>
                    </Badge>
                ))}
            </Box>
        </Paper>
    );

    return (
        <Box sx={{ 
            p: 4, bgcolor: '#050c1a', borderRadius: 4, color: '#fff', 
            width: '1400px', maxWidth: '98vw', height: '90vh', display: 'flex', flexDirection: 'column',
            border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 64px rgba(0,0,0,0.8)'
        }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                <Box>
                    <Typography variant="h4" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <DoubleArrowIcon sx={{ fontSize: 40 }} color="warning" /> {t("Saldırı Tasarımcısı")}
                    </Typography>
                    <Typography color="gray">{t("Dalgalarınızı ve kanatlarınızı özelleştirin.")}</Typography>
                </Box>
                <IconButton onClick={onClose} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,0,0,0.2)' } }}><CloseIcon /></IconButton>
            </Box>

            <Tabs value={currentWave} onChange={(_, nv) => setCurrentWave(nv)} sx={{ mb: 4, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>
                {[1, 2, 3, 4].map((w, i) => <Tab key={i} label={`${w}. ${t("DALGA")}`} sx={{ fontWeight: 'bold', minWidth: '150px', fontSize: '1rem' }} />)}
            </Tabs>

            <Grid container spacing={4} sx={{ flexGrow: 1, overflow: 'hidden' }}>
                {/* ENVANTER PANELİ */}
                <Grid item xs={3.5} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Paper sx={{ p: 3, bgcolor: 'rgba(0,0,0,0.3)', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 3, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Typography variant="h6" sx={{ mb: 2, color: '#90caf9', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <GavelIcon /> {t("Birimler")}
                        </Typography>
                        <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 3, pr: 1 }}>
                            {units.map((item, i) => (
                                <Box 
                                    key={i} draggable onDragStart={(e) => handleDragStart(e, item)}
                                    sx={{ p: 1, bgcolor: '#1e1e1e', borderRadius: 2, cursor: 'grab', border: '1px solid #333', textAlign: 'center', '&:hover': { borderColor: '#90caf9', transform: 'scale(1.05)' }, transition: 'all 0.2s' }}
                                >
                                    <Badge badgeContent={item.count} color="secondary" max={9999}><Avatar variant="rounded" sx={{ width: 50, height: 50, bgcolor: '#2e7d32', mx: 'auto' }}>{item.name[0]}</Avatar></Badge>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', mt: 1, fontSize: '0.7rem' }}>{item.name}</Typography>
                                </Box>
                            ))}
                        </Box>
                        
                        <Divider sx={{ my: 2, opacity: 0.1 }} />
                        
                        <Typography variant="h6" sx={{ mb: 2, color: '#ffb74d', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <ConstructionIcon /> {t("Aletler")}
                        </Typography>
                        <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, pr: 1 }}>
                            {tools.map((item, i) => (
                                <Box 
                                    key={i} draggable onDragStart={(e) => handleDragStart(e, item)}
                                    sx={{ p: 1, bgcolor: '#1e1e1e', borderRadius: 2, cursor: 'grab', border: '1px solid #333', textAlign: 'center', '&:hover': { borderColor: '#ffb74d', transform: 'scale(1.05)' }, transition: 'all 0.2s' }}
                                >
                                    <Badge badgeContent={item.count} color="secondary" max={9999}><Avatar variant="rounded" sx={{ width: 50, height: 50, bgcolor: '#ed6c02', mx: 'auto' }}>{item.name[0]}</Avatar></Badge>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', mt: 1, fontSize: '0.7rem' }}>{item.name}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Paper>
                </Grid>

                {/* TASARIM PANELİ */}
                <Grid item xs={8.5} sx={{ height: '100%' }}>
                    <Box sx={{ display: 'flex', gap: 3, height: '100%' }}>
                        {[
                            { id: 'left', label: "SOL KANAT", color: '#90caf9' },
                            { id: 'mid', label: "MERKEZ", color: '#f44336' },
                            { id: 'right', label: "SAĞ KANAT", color: '#90caf9' }
                        ].map(f => (
                            <Box key={f.id} sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Typography textAlign="center" sx={{ fontWeight: 'bold', color: f.color, letterSpacing: 2 }}>{t(f.label)}</Typography>
                                <Slot flank={f.id} type="units" label={t("Askerler")} color={f.color} />
                                <Slot flank={f.id} type="tools" label={t("Aletler")} color={f.color} />
                            </Box>
                        ))}
                    </Box>
                </Grid>
            </Grid>

            <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                <Button variant="outlined" onClick={onClose} sx={{ px: 6, py: 1.5, borderRadius: 2 }}>{t("İptal")}</Button>
                <Button variant="contained" color="warning" startIcon={<DoubleArrowIcon />} onClick={() => onSave(plan)} sx={{ px: 8, py: 1.5, borderRadius: 2, fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t("Saldırı Planını Onayla")}
                </Button>
            </Box>

            {/* MİKTAR SEÇİM POPUP - Z-INDEX FIX */}
            <Dialog 
                open={!!dropData} 
                onClose={() => setDropData(null)}
                sx={{ zIndex: 10000 }} // Backdrop'un üstünde olması için
            >
                <DialogTitle sx={{ bgcolor: '#1e1e1e', color: '#fff' }}>{t("Miktar Girin")}</DialogTitle>
                <DialogContent sx={{ bgcolor: '#1e1e1e', pt: 2 }}>
                    <Typography variant="body2" sx={{ mb: 2, color: '#aaa' }}>{dropData?.item?.name} {t("için eklenecek sayı:")}</Typography>
                    <TextField 
                        autoFocus fullWidth type="number" 
                        value={quantity} 
                        onChange={(e) => setQuantity(e.target.value)}
                        variant="outlined" size="small"
                        sx={{ input: { color: '#fff' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' } }}
                    />
                </DialogContent>
                <DialogActions sx={{ bgcolor: '#1e1e1e', p: 2 }}>
                    <Button onClick={() => setDropData(null)} color="inherit">{t("İptal")}</Button>
                    <Button onClick={confirmAdd} variant="contained" color="primary">{t("Ekle")}</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
