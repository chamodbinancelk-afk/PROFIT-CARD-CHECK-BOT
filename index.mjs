// ... [getLatestEvent() function eke ihala kotasa] ...
            const previous = row.find('.calendar__previous').text().trim() || "0";
            const time = row.find('.calendar__time').text().trim();
            
            // 🛑 IMPACT FIX: title eken lebuna nethnam, class eken theerana karamu
            const impactSpan = row.find('.calendar__impact').find('span'); // span eka soya ganna
            let impact = impactSpan.attr('title'); // Mulinda title attribute eka kiyawanawa

            if (!impact || impact.trim() === '') {
                // title eka hiri nowuna nethnam, class eka balamu
                const classAttr = impactSpan.attr('class') || '';
                if (classAttr.includes('ff-impact-red')) {
                    impact = "High Impact Expected";
                } else if (classAttr.includes('ff-impact-ora')) {
                    impact = "Medium Impact Expected";
                } else if (classAttr.includes('ff-impact-yel')) {
                    impact = "Low Impact Expected";
                } else {
                    impact = "Unknown";
                }
            }

            impact = impact || "Unknown"; // Awasaana thahawuru kirima
            
            if (eventId && currency && title && actual && actual !== "-") {
// ... [getLatestEvent() function eke pahala kotasa] ...
